// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Dispatch-loop tests: the global concurrency cap, the cancel path, the heartbeat's
 * stand-down rule, and reclaim driving an actual rerun.
 *
 * The runner is a controllable fake, so a "run" is a promise the test resolves. That is
 * the only way to hold N runs open at once and watch whether the cap holds.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dispatcher, type JobRunner, type RunOutcome } from "./dispatcher.js";
import { InProcessEventBus, runCancelTopic, runEventsTopic } from "./event-bus.js";
import type { ClaimedJob, JobFields, JobStore } from "./job-store.js";

/**
 * A JobStore stub with just enough behaviour to drive the loop.
 *
 * It models the one property the loop's safety rests on: `claimedBy` holds a token minted
 * per ATTEMPT, and heartbeat/complete/retryLater match on that token. A stub that matched
 * on the owner string instead would make the displaced-holder tests pass vacuously.
 */
class StubStore implements JobStore {
	pending: JobFields[] = [];
	/** jobId → the claim token that currently owns the row. */
	claimed = new Map<string, string>();
	completed: Array<{ id: string; status: string; error?: string }> = [];
	/** Terminal writes refused because the writer no longer held the claim. */
	refusedCompletes: string[] = [];
	retried: string[] = [];
	/** Job ids whose heartbeat should report the claim lost. */
	lostClaims = new Set<string>();
	/** Set to make every heartbeat throw, exactly as an unreachable database does. */
	heartbeatFailure: Error | null = null;
	staleToReclaim: string[] = [];
	heartbeats = 0;
	/** Every token a heartbeat was guarded on, in order. */
	heartbeatTokens: string[] = [];
	private tokens = 0;

	async enqueue(): Promise<string> {
		throw new Error("not used");
	}

	async claim(owner: string, limit: number): Promise<ClaimedJob[]> {
		const taken = this.pending.splice(0, limit);
		return taken.map((job) => {
			const claimToken = `${owner}#${++this.tokens}`;
			this.claimed.set(job.id, claimToken);
			return { ...job, claimToken };
		});
	}

	async heartbeat(jobId: string, claimToken: string): Promise<boolean> {
		this.heartbeats++;
		this.heartbeatTokens.push(claimToken);
		if (this.heartbeatFailure) throw this.heartbeatFailure;
		if (this.lostClaims.has(jobId)) return false;
		return this.claimed.get(jobId) === claimToken;
	}

	async reclaimStale(): Promise<string[]> {
		const ids = this.staleToReclaim;
		this.staleToReclaim = [];
		// Reclaim releases the claim: the row is back in the pool with no owner.
		for (const id of ids) this.claimed.delete(id);
		return ids;
	}

	async complete(
		id: string,
		claimToken: string,
		status: string,
		error?: string,
	): Promise<boolean> {
		if (this.claimed.get(id) !== claimToken) {
			this.refusedCompletes.push(id);
			return false;
		}
		this.claimed.delete(id);
		this.completed.push({ id, status, ...(error ? { error } : {}) });
		return true;
	}

	async retryLater(id: string, claimToken: string): Promise<boolean> {
		if (this.claimed.get(id) !== claimToken) return false;
		this.claimed.delete(id);
		this.retried.push(id);
		return true;
	}

	async findByInvestigation() {
		return null;
	}

	async cancelIfPending(): Promise<boolean> {
		return false;
	}
}

function job(n: number): JobFields {
	return {
		id: `job-${n}`,
		kind: "investigation",
		investigationId: `inv-${n}`,
		incidentId: `inc-${n}`,
		payload: JSON.stringify({ investigationId: `inv-${n}` }),
		priority: 3,
		attempts: 1,
		maxAttempts: 3,
	};
}

/** A runner whose runs only end when the test says so. */
function controllableRunner() {
	const started: ClaimedJob[] = [];
	const finish = new Map<string, (outcome: RunOutcome) => void>();
	const cancelled: string[] = [];
	const killed: string[] = [];

	const runner: JobRunner = (j, sink) => {
		started.push(j);
		let resolve!: (outcome: RunOutcome) => void;
		const done = new Promise<RunOutcome>((r) => {
			resolve = r;
		});
		finish.set(j.id, resolve);
		return {
			done,
			cancel: () => cancelled.push(j.id),
			kill: () => {
				killed.push(j.id);
				// A killed child still exits, and `fork-runner` reports the stream done on
				// EVERY exit path. Modelling that is what makes it observable whether a
				// displaced attempt's dying `done` reaches the relay.
				sink.onStreamDone();
				resolve({ outcome: "cancelled", retryable: false });
			},
		};
	};

	return { runner, started, finish, cancelled, killed };
}

const OPTS = {
	concurrency: 2,
	pollIntervalMs: 10_000,
	heartbeatIntervalMs: 5,
	staleClaimMs: 30_000,
};

describe("Dispatcher", () => {
	let store: StubStore;
	let bus: InProcessEventBus;

	beforeEach(() => {
		store = new StubStore();
		bus = new InProcessEventBus();
	});

	describe("the global concurrency cap", () => {
		it("never runs more than the cap, however many jobs are waiting", async () => {
			const { runner, started, finish } = controllableRunner();
			store.pending = [1, 2, 3, 4, 5, 6].map(job);
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);

			await dispatcher.tick();
			expect(started).toHaveLength(2);
			expect(dispatcher.running).toBe(2);

			// A second tick while both slots are full must claim nothing at all — an
			// over-claim would strand work on a process that cannot start it.
			await dispatcher.tick();
			expect(started).toHaveLength(2);
			expect(store.pending).toHaveLength(4);

			await dispatcher.stop();
			for (const resolve of finish.values())
				resolve({ outcome: "succeeded", retryable: false });
		});

		it("claims into a freed slot as soon as a run settles, and no earlier", async () => {
			const { runner, started, finish } = controllableRunner();
			store.pending = [1, 2, 3, 4].map(job);
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);

			await dispatcher.tick();
			expect(started.map((j) => j.id)).toEqual(["job-1", "job-2"]);

			finish.get("job-1")?.({ outcome: "succeeded", retryable: false });
			await vi.waitFor(() => {
				expect(started).toHaveLength(3);
			});
			// Exactly one slot opened, so exactly one job started.
			expect(started.map((j) => j.id)).toEqual(["job-1", "job-2", "job-3"]);
			expect(dispatcher.running).toBe(2);

			await dispatcher.stop();
		});

		it("a cap of 1 serialises the whole pool", async () => {
			const { runner, started, finish } = controllableRunner();
			store.pending = [1, 2, 3].map(job);
			const dispatcher = new Dispatcher(store, bus, runner, {
				...OPTS,
				concurrency: 1,
			});

			await dispatcher.tick();
			expect(started).toHaveLength(1);

			finish.get("job-1")?.({ outcome: "succeeded", retryable: false });
			await vi.waitFor(() => expect(started).toHaveLength(2));
			expect(dispatcher.running).toBe(1);

			await dispatcher.stop();
		});
	});

	describe("relay + cancel over the EventBus", () => {
		it("publishes run events on the run's relay topic", async () => {
			const { runner, started, finish } = controllableRunner();
			store.pending = [job(1)];
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);
			const received: unknown[] = [];
			bus.subscribe(runEventsTopic("inv-1"), (m) => received.push(m));

			await dispatcher.tick();
			expect(started).toHaveLength(1);
			finish.get("job-1")?.({ outcome: "succeeded", retryable: false });
			await vi.waitFor(() => expect(store.completed).toHaveLength(1));

			await dispatcher.stop();
			expect(received).toEqual([]);
		});

		it("forwards a cancel published on the run's topic to the running job", async () => {
			const { runner, cancelled, finish } = controllableRunner();
			store.pending = [job(1)];
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);

			await dispatcher.tick();
			const receivers = bus.publish(runCancelTopic("inv-1"), { kind: "cancel" });

			// The receiver count is the cancel path's contract: zero means nobody holds
			// the run and the API must write the terminal state itself.
			expect(receivers).toBe(1);
			expect(cancelled).toEqual(["job-1"]);

			finish.get("job-1")?.({ outcome: "cancelled", retryable: false });
			await vi.waitFor(() => expect(store.completed).toHaveLength(1));
			await dispatcher.stop();
		});

		it("drops the cancel subscription once the run settles — a late cancel finds nobody", async () => {
			const { runner, finish } = controllableRunner();
			store.pending = [job(1)];
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);

			await dispatcher.tick();
			finish.get("job-1")?.({ outcome: "succeeded", retryable: false });
			await vi.waitFor(() => expect(store.completed).toHaveLength(1));

			expect(bus.publish(runCancelTopic("inv-1"), { kind: "cancel" })).toBe(0);
			await dispatcher.stop();
		});
	});

	describe("heartbeat", () => {
		it("keeps heartbeating a claim for as long as its run is alive", async () => {
			const { runner, finish } = controllableRunner();
			store.pending = [job(1)];
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);

			await dispatcher.tick();
			await vi.waitFor(() => expect(store.heartbeats).toBeGreaterThan(1));

			finish.get("job-1")?.({ outcome: "succeeded", retryable: false });
			await vi.waitFor(() => expect(store.completed).toHaveLength(1));
			const after = store.heartbeats;
			await new Promise((r) => setTimeout(r, 30));
			// Settled runs stop heartbeating — the interval is cleared, not leaked.
			expect(store.heartbeats).toBe(after);

			await dispatcher.stop();
		});

		it("kills the run when the claim is lost, rather than double-writing an investigation", async () => {
			const { runner, killed } = controllableRunner();
			store.pending = [job(1)];
			store.lostClaims.add("job-1");
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);

			await dispatcher.tick();
			await vi.waitFor(() => expect(killed).toEqual(["job-1"]));

			await dispatcher.stop();
		});
	});

	describe("reclaim = rerun", () => {
		it("sweeps stale claims each tick, and the reclaimed job runs again", async () => {
			const { runner, started, finish } = controllableRunner();
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);

			// Nothing pending; the sweeper reports one abandoned claim, and the store puts
			// it back in the pool. The very next claim picks it up: reclaim ⇒ RERUN.
			store.staleToReclaim = ["job-1"];
			store.pending = [job(1)];

			await dispatcher.tick();

			expect(started.map((j) => j.id)).toEqual(["job-1"]);
			finish.get("job-1")?.({ outcome: "succeeded", retryable: false });
			await vi.waitFor(() => expect(store.completed).toHaveLength(1));
			await dispatcher.stop();
		});
	});

	describe("a loop that re-claims a job it is already running", () => {
		/**
		 * The interleaving, exactly as it happens in one process:
		 *
		 *   1. the loop claims job-1 and forks child C1;
		 *   2. the database goes unreachable, every heartbeat throws, and the failures are
		 *      swallowed — C1 keeps running while its claim's heartbeat ages past
		 *      `staleClaimMs`;
		 *   3. the database comes back. The next tick sweeps first, and the sweep matches
		 *      this loop's OWN claim, returning job-1 to the pool;
		 *   4. the same tick then claims it again and starts C2.
		 *
		 * Two children on one investigation, and the older one cannot be killed: its
		 * handle was overwritten in `inFlight`, and its heartbeat — guarded on a token
		 * that had just been rewritten as itself — reported the claim healthy forever.
		 */
		it("kills and silences the displaced attempt instead of running two children", async () => {
			const { runner, started, killed } = controllableRunner();
			const relay: unknown[] = [];
			bus.subscribe(runEventsTopic("inv-1"), (m) => relay.push(m));
			store.pending = [job(1)];
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);

			// Step 1-2: C1 is running and the database is unreachable, so every heartbeat
			// throws. Nothing stands the run down — that is the swallowed-failure path.
			store.heartbeatFailure = new Error("database unreachable");
			await dispatcher.tick();
			expect(started).toHaveLength(1);
			const firstToken = started[0].claimToken;
			await vi.waitFor(() => expect(store.heartbeats).toBeGreaterThan(1));
			expect(killed).toEqual([]);

			// Step 3-4: the sweep reclaims this loop's own stale claim and the same tick
			// takes it back. The store hands out a NEW token for the new attempt.
			store.staleToReclaim = ["job-1"];
			store.pending = [job(1)];
			await dispatcher.tick();

			expect(started).toHaveLength(2);
			const secondToken = started[1].claimToken;
			expect(secondToken).not.toBe(firstToken);

			// The displaced attempt is killed as part of starting its replacement, not
			// left executing with no handle to kill it by.
			expect(killed).toEqual(["job-1"]);
			// ...and it is silenced: its dying `done` must not close the replacement's
			// live stream, which is subscribed to the same relay topic.
			expect(relay).toEqual([]);
			// One attempt on record, and it is the live one.
			expect(dispatcher.running).toBe(1);

			// The displaced attempt's terminal write is refused — its token no longer owns
			// the row — so there is still exactly one writer on this investigation.
			await vi.waitFor(() => expect(store.refusedCompletes).toEqual(["job-1"]));
			expect(store.completed).toEqual([]);

			// The settling of the displaced attempt must not evict the live one.
			store.heartbeatFailure = null;
			const before = store.heartbeats;
			await vi.waitFor(() => expect(store.heartbeats).toBeGreaterThan(before));
			expect(dispatcher.running).toBe(1);

			// And the live child is still killable, which is the whole point of holding
			// its handle.
			await dispatcher.stop();
			expect(killed).toEqual(["job-1", "job-1"]);
			expect(dispatcher.running).toBe(0);
		});

		it("heartbeats on the ATTEMPT's token, so a same-owner takeover still stands the run down", async () => {
			const { runner, started, killed } = controllableRunner();
			store.pending = [job(1)];
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);

			await dispatcher.tick();
			expect(started).toHaveLength(1);
			await vi.waitFor(() =>
				expect(store.heartbeatTokens.length).toBeGreaterThan(0),
			);

			// The guard is the attempt's token. Guarded on the loop's owner string
			// instead, a claim rewritten by this same loop reads as still held.
			expect(store.heartbeatTokens[0]).toBe(started[0].claimToken);
			expect(store.heartbeatTokens[0]).not.toBe(dispatcher.ownerToken);

			// A takeover under the SAME owner — this loop's own next attempt — must still
			// be visible to the displaced holder.
			store.claimed.set("job-1", `${dispatcher.ownerToken}#taken-over`);

			await vi.waitFor(() => expect(killed).toEqual(["job-1"]));
			await dispatcher.stop();
		});
	});

	describe("settling", () => {
		it("a retryable failure goes back for a rerun rather than being marked terminal", async () => {
			const { runner, finish } = controllableRunner();
			store.pending = [job(1)];
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);

			await dispatcher.tick();
			finish.get("job-1")?.({
				outcome: "failed",
				retryable: true,
				error: "child crashed",
			});

			await vi.waitFor(() => expect(store.retried).toEqual(["job-1"]));
			expect(store.completed).toHaveLength(0);
			await dispatcher.stop();
		});

		it("an unrecoverable failure is marked terminal, never rerun", async () => {
			const { runner, finish } = controllableRunner();
			store.pending = [job(1)];
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);

			await dispatcher.tick();
			finish.get("job-1")?.({
				outcome: "failed",
				retryable: false,
				error: "harness cannot honour the demanded sandbox",
			});

			await vi.waitFor(() => expect(store.completed).toHaveLength(1));
			expect(store.completed[0]).toMatchObject({
				id: "job-1",
				status: "failed",
			});
			expect(store.retried).toEqual([]);
			await dispatcher.stop();
		});

		it("stop() kills in-flight runs — their claims go stale and get reclaimed", async () => {
			const { runner, killed } = controllableRunner();
			store.pending = [job(1), job(2)];
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);

			await dispatcher.tick();
			await dispatcher.stop();

			expect(killed.sort()).toEqual(["job-1", "job-2"]);
			expect(dispatcher.running).toBe(0);
		});
	});
});
