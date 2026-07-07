// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Fan-out — run each decomposed Branch on the rented Tier-2 harness and yield the
 * merged canonical stream (ADR-0016). All iterative depth happens INSIDE a branch
 * (the rented ReAct loop); this layer only dispatches branches and relays events.
 *
 * N=1 (the single "root" branch): a pass-through of the one harness run with the SAME
 * failure containment as a sibling at N>1 — once events have flowed, a mid-run harness
 * abort (e.g. deepagents killing its whole turn on one tool exception) gets ONE
 * automatic respawn (a fresh session on the same prompt, announced by a respawn-notice
 * `error` event); a second abort becomes the branch's terminal `error` event, the
 * stream drains normally, and reduce() still synthesizes a PARTIAL report from the
 * evidence already gathered. Failure is data, not death (2026-07-07 hardening;
 * ADR-0018 amended). A failure BEFORE the first event (binary missing, config
 * rejection, init handshake) still PROPAGATES — that class is an actionable setup
 * error with no evidence to salvage, and the conductor's try/catch +
 * investigateIncident's throw path rely on it.
 *
 * N>1 (per-alert fan-out, ADR-0016 decision 2): run branches CONCURRENTLY behind a
 * concurrency cap (an inline p-limit-style lane pool — no new deps), interleaving
 * each branch's CanonicalEvents into the single outgoing stream AS THEY ARRIVE. Each
 * event already carries its own branchId/path (stamped by the branch's adapter — the
 * (branchId, seq) key disambiguates the interleave, ADR-0008), so downstream (the UI
 * drill-down, the reduce map-reduce) needs no change. A branch that FAILS must not
 * kill its siblings: a thrown error is caught, converted to a terminal `error` event
 * for THAT branch, and the run continues — the reduce step then excludes an
 * evidence-less branch (per-branch no-evidence guard, ADR-0002).
 */
import type { CanonicalEvent } from "@prismalens/contracts";
import type { Branch } from "./decompose.js";
import type { HarnessRunner } from "./investigate.js";

/** Fan-out tuning (ADR-0016 decision 2). */
export interface FanOutOptions {
	/**
	 * Max branches running at once. Defaults to `branches.length` — every (already
	 * decompose-capped, so ≤ maxBranches) branch runs concurrently. A lower value
	 * throttles the harness fleet; a branch finishing frees its lane for the next.
	 */
	concurrency?: number;
}

/**
 * One automatic respawn per branch after a mid-run harness abort. The rented loop
 * (deepagents) kills its whole turn on a single tool exception — a transient class
 * worth exactly one fresh attempt (Codex/Claude Code precedent: bounded retries,
 * never unbounded). The respawn re-runs the branch's prompt in a NEW harness
 * session; a second abort is terminal.
 */
const MAX_BRANCH_RESPAWNS = 1;

/** Synthesize a branch-stamped `error` event (respawn notice or terminal). */
function branchErrorEvent(
	runId: string,
	branchId: string,
	seq: number,
	message: string,
): CanonicalEvent {
	return {
		kind: "error",
		runId,
		branchId,
		path: [],
		seq,
		ts: new Date().toISOString(),
		message,
	};
}

/**
 * Run ONE branch with mid-run containment + the bounded respawn: a throw AFTER events
 * have flowed yields a respawn-notice `error` event and re-runs the prompt once; a
 * second abort yields the terminal `error` event. Respawned attempts restart the
 * adapter's seq at 0, so their events are re-stamped to continue this branch's own
 * monotonic (branchId, seq) line — durability and the UI drill-down key on it.
 * Throws ONLY when the FIRST attempt fails before its first event (binary missing,
 * init handshake): no evidence exists to salvage and the caller needs the setup error.
 */
async function* runBranch(
	branch: Branch,
	harness: HarnessRunner,
	runId: string,
): AsyncGenerator<CanonicalEvent> {
	let seq = 0; // next seq for this branch — continues across attempts
	let sawEvent = false;
	for (let attempt = 0; ; attempt++) {
		const base = seq;
		try {
			for await (const ev of harness(branch.prompt, {
				runId,
				branchId: branch.branchId,
			})) {
				sawEvent = true;
				const stamped = base > 0 ? { ...ev, seq: ev.seq + base } : ev;
				seq = stamped.seq + 1;
				yield stamped;
			}
			return;
		} catch (err) {
			if (!sawEvent) throw err;
			const message = String(
				(err as { message?: unknown } | null)?.message ?? err,
			);
			if (attempt < MAX_BRANCH_RESPAWNS) {
				yield branchErrorEvent(
					runId,
					branch.branchId,
					seq++,
					`harness aborted mid-run — respawning branch once (attempt ${attempt + 2}/${MAX_BRANCH_RESPAWNS + 1}): ${message}`,
				);
				continue;
			}
			yield branchErrorEvent(runId, branch.branchId, seq, message);
			return;
		}
	}
}

/** Dispatch every branch to the harness and relay its canonical events. */
export async function* fanOut(
	branches: Branch[],
	harness: HarnessRunner,
	runId: string,
	opts: FanOutOptions = {},
): AsyncGenerator<CanonicalEvent> {
	if (branches.length === 0) return;

	// N=1 fast path: the shared branch runner contains mid-run aborts (respawn once,
	// then terminal error event) and rethrows pre-first-event setup failures — no
	// evidence exists yet, so a partial report is impossible and the caller needs
	// the actionable setup error.
	if (branches.length === 1) {
		yield* runBranch(branches[0], harness, runId);
		return;
	}

	yield* interleave(
		branches,
		harness,
		runId,
		opts.concurrency ?? branches.length,
	);
}

/**
 * Concurrency-capped merge of N branch streams into one, yielding events as they
 * arrive from ANY branch. A promise-signalled buffer decouples the (many) branch
 * producers from the single consumer; `concurrency` lanes each pull the next branch
 * until the queue drains. A branch's thrown error terminates only that branch.
 */
async function* interleave(
	branches: Branch[],
	harness: HarnessRunner,
	runId: string,
	concurrency: number,
): AsyncGenerator<CanonicalEvent> {
	const buffer: CanonicalEvent[] = [];
	let wake: (() => void) | null = null;
	let finished = false;
	let cancelled = false;

	// Signal the consumer that the buffer / finished-flag changed. A signal that
	// arrives while the consumer is NOT parked is harmless — it re-checks the buffer.
	const notify = () => {
		if (wake) {
			wake();
			wake = null;
		}
	};

	// One branch's producer: relay its events into the buffer. Mid-run aborts are
	// already contained by runBranch (respawn once → terminal `error` event); the
	// catch below handles only the pre-first-event setup class it rethrows, which
	// at N>1 also becomes a branch `error` event so siblings live on and the reduce
	// step sees the branch ended.
	const pump = async (branch: Branch) => {
		let seq = 0;
		const it = runBranch(branch, harness, runId)[Symbol.asyncIterator]();
		try {
			while (true) {
				// Consumer abandoned the merged stream (break/throw upstream): stop this
				// branch at its next event boundary and let the harness generator's own
				// finally clean up (acp-client kills the child + run-owned sandbox).
				if (cancelled) {
					await it.return?.(undefined);
					break;
				}
				const { value: ev, done } = await it.next();
				if (done) break;
				seq = ev.seq + 1;
				buffer.push(ev);
				notify();
			}
		} catch (err) {
			buffer.push(
				branchErrorEvent(
					runId,
					branch.branchId,
					seq,
					String((err as { message?: unknown } | null)?.message ?? err),
				),
			);
			notify();
		}
	};

	// Lane pool: each lane pulls the next un-started branch until the list is
	// exhausted. `cap` lanes ⇒ at most `cap` branches in flight at once.
	let cursor = 0;
	const lane = async () => {
		while (cursor < branches.length) {
			await pump(branches[cursor++]);
		}
	};
	const cap = Math.max(1, Math.min(concurrency, branches.length));
	const lanes = Promise.all(Array.from({ length: cap }, lane)).then(() => {
		finished = true;
		notify();
	});

	// Drain: yield everything buffered, then park until a producer signals; the
	// synchronous drain→park is atomic (single-threaded), so no wake-up is lost.
	// The finally makes early abandonment (consumer break/throw → generator.return())
	// cancel the branches instead of pumping rented harnesses into a dead buffer.
	// (Caveat: cancellation lands at the abandoned yield; a return() issued while
	// parked at the await settles on the next producer event — the pumps then stop
	// at their next boundary either way.)
	try {
		while (true) {
			while (buffer.length > 0) {
				// biome-ignore lint/style/noNonNullAssertion: guarded by buffer.length > 0.
				yield buffer.shift()!;
			}
			if (finished) break;
			await new Promise<void>((resolve) => {
				wake = resolve;
			});
		}
	} finally {
		cancelled = true;
		cursor = branches.length; // no lane starts another branch
		await lanes; // lanes never reject (pump swallows) — just settle them.
	}
}
