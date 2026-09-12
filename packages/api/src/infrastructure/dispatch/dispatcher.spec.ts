// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Dispatch-loop tests: the global concurrency cap, the cancel path, and settling
 * (0005 §2 — no heartbeat, no reclaim, tick-driven rather than polled).
 *
 * The runner is a controllable fake, so a "run" is a promise the test resolves. That is
 * the only way to hold N runs open at once and watch whether the cap holds.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalEvent } from "@prismalens/contracts";
import {
	Dispatcher,
	type JobRunner,
	type RunOutcome,
	type RunSink,
} from "./dispatcher.js";
import {
	InProcessEventBus,
	type RelayMessage,
	runCancelTopic,
	runEventsTopic,
} from "./event-bus.js";
import type { ClaimedJob, JobFields, JobStore } from "./job-store.js";

/** A JobStore stub with just enough behaviour to drive the loop. */
class StubStore implements JobStore {
	pending: JobFields[] = [];
	/** jobId → owner that currently holds the row. */
	claimed = new Map<string, string>();
	completed: Array<{ id: string; status: string; error?: string }> = [];

	async enqueue(): Promise<string> {
		throw new Error("not used");
	}

	async claim(owner: string, limit: number): Promise<ClaimedJob[]> {
		const taken = this.pending.splice(0, limit);
		for (const job of taken) this.claimed.set(job.id, owner);
		return taken;
	}

	async complete(
		id: string,
		status: string,
		error?: string,
	): Promise<boolean> {
		if (!this.claimed.has(id)) return false;
		this.claimed.delete(id);
		this.completed.push({ id, status, ...(error ? { error } : {}) });
		return true;
	}

	async findByInvestigation() {
		return null;
	}

	async cancelIfPending(): Promise<boolean> {
		return false;
	}

	async cancelOrphanedRun(): Promise<boolean> {
		return false;
	}

	async failRunning(): Promise<string[]> {
		return [];
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
	};
}

/** A runner whose runs only end when the test says so. */
function controllableRunner() {
	const started: ClaimedJob[] = [];
	const finish = new Map<string, (outcome: RunOutcome) => void>();
	const cancelled: string[] = [];
	const killed: string[] = [];
	const sinks = new Map<string, RunSink>();

	const runner: JobRunner = (j, sink) => {
		started.push(j);
		sinks.set(j.id, sink);
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
				sink.onStreamDone();
				resolve({ outcome: "cancelled" });
			},
		};
	};

	return { runner, started, finish, cancelled, killed, sinks };
}

const OPTS = { concurrency: 2 };

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
				resolve({ outcome: "succeeded" });
		});

		it("claims into a freed slot as soon as a run settles, and no earlier", async () => {
			const { runner, started, finish } = controllableRunner();
			store.pending = [1, 2, 3, 4].map(job);
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);

			await dispatcher.tick();
			expect(started.map((j) => j.id)).toEqual(["job-1", "job-2"]);

			finish.get("job-1")?.({ outcome: "succeeded" });
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

			finish.get("job-1")?.({ outcome: "succeeded" });
			await vi.waitFor(() => expect(started).toHaveLength(2));
			expect(dispatcher.running).toBe(1);

			await dispatcher.stop();
		});
	});

	describe("relay + cancel over the EventBus", () => {
		it("publishes run events on the run's relay topic", async () => {
			const { runner, started, finish, sinks } = controllableRunner();
			store.pending = [job(1)];
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);
			const received: RelayMessage[] = [];
			bus.subscribe<RelayMessage>(runEventsTopic("inv-1"), (m) =>
				received.push(m),
			);

			await dispatcher.tick();
			expect(started).toHaveLength(1);

			const sampleEvent: CanonicalEvent = {
				kind: "error",
				runId: "11111111-1111-4111-8111-111111111111",
				branchId: "main",
				path: [],
				seq: 1,
				ts: new Date(0).toISOString(),
				message: "test-event",
			};

			const sink = sinks.get("job-1");
			expect(sink).toBeDefined();
			sink?.onEvent(sampleEvent);
			sink?.onStreamDone();

			expect(received).toEqual([
				{ kind: "event", event: sampleEvent },
				{ kind: "done" },
			]);

			finish.get("job-1")?.({ outcome: "succeeded" });
			await vi.waitFor(() => expect(store.completed).toHaveLength(1));

			await dispatcher.stop();
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

			finish.get("job-1")?.({ outcome: "cancelled" });
			await vi.waitFor(() => expect(store.completed).toHaveLength(1));
			await dispatcher.stop();
		});

		it("drops the cancel subscription once the run settles — a late cancel finds nobody", async () => {
			const { runner, finish } = controllableRunner();
			store.pending = [job(1)];
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);

			await dispatcher.tick();
			finish.get("job-1")?.({ outcome: "succeeded" });
			await vi.waitFor(() => expect(store.completed).toHaveLength(1));

			expect(bus.publish(runCancelTopic("inv-1"), { kind: "cancel" })).toBe(0);
			await dispatcher.stop();
		});
	});

	describe("settling", () => {
		it("records a failed outcome terminally", async () => {
			const { runner, finish } = controllableRunner();
			store.pending = [job(1)];
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);

			await dispatcher.tick();
			finish.get("job-1")?.({
				outcome: "failed",
				error: "harness cannot honour the demanded sandbox",
			});

			await vi.waitFor(() => expect(store.completed).toHaveLength(1));
			expect(store.completed[0]).toMatchObject({
				id: "job-1",
				status: "failed",
			});
			await dispatcher.stop();
		});

		it("stop() kills in-flight runs", async () => {
			const { runner, killed } = controllableRunner();
			store.pending = [job(1), job(2)];
			const dispatcher = new Dispatcher(store, bus, runner, OPTS);

			await dispatcher.tick();
			await dispatcher.stop();

			expect(killed.sort()).toEqual(["job-1", "job-2"]);
			expect(dispatcher.running).toBe(0);
		});

		it("a freed slot is claimed immediately after a run settles, without waiting for another tick", async () => {
			const { runner, started, finish } = controllableRunner();
			store.pending = [job(1)];
			const dispatcher = new Dispatcher(store, bus, runner, {
				...OPTS,
				concurrency: 1,
			});

			await dispatcher.tick();
			expect(started).toHaveLength(1);

			store.pending = [job(2)];
			finish.get("job-1")?.({ outcome: "succeeded" });

			await vi.waitFor(() => expect(started).toHaveLength(2));
			await dispatcher.stop();
		});
	});
});
