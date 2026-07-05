// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Conduct one investigation: drive the supervisor stream, fan every canonical
 * event to a SINK, and drive a durable STORE through its lifecycle, returning the
 * terminal outcome. Two ports vary across runtimes; the drive-loop + lifecycle
 * ordering are owned here ONCE (architecture-review candidate #2 — the drive-loop
 * was otherwise hand-rolled in each consumer):
 *
 *   - SINK  (live/ephemeral) — every canonical event as it streams:
 *       CLI `investigate` → a terminal timeline line
 *       CLI `serve`       → a JSON-RPC `investigate/event` notification
 *       web worker        → publish to the Redis stream channel (→ SSE → UI)
 *       standalone        → append to the `~/.prismalens` events file
 *   - STORE (durable lifecycle) — create → append(per event) → finish|fail:
 *       CLI  → sessions.create → appendEvent → writeReport+done | update(errored)
 *       worker → status(running)+timeline(started) → NO-OP append →
 *                writeResult+timeline(completed) | status(failed)+timeline(failed)
 *
 * The engine stays db/env-clean (ADR-0011): the caller supplies a {@link
 * InvestigationStore} adapter, and `conductRun` owns the create→append→finish/fail
 * ordering. The report-capture lives HERE (the terminal `report` event), not in the
 * sink. The no-evidence guard lives in {@link investigateIncidentStream} — it emits
 * no `report` event when a branch gathered nothing, so `report` stays null here and
 * we resolve `store.fail` instead of laundering a fabricated report.
 */
import { randomUUID } from "node:crypto";
import type {
	CanonicalEvent,
	InvestigationReport,
} from "@prismalens/contracts";
import {
	type InvestigateOptions,
	investigateIncidentStream,
	isCancelledError,
} from "./investigate.js";

/** Receives every canonical event as it streams. May be async (awaited in order). */
export type InvestigationSink = (event: CanonicalEvent) => void | Promise<void>;

/**
 * The durable lifecycle port (ADR-0018): the persistence that varies per runtime
 * (file/session vs DB row vs none). `conductRun` calls these in a fixed order —
 * `create` once, `append` per event (incl. the terminal report event), then exactly
 * one of `finish` / `fail`.
 */
export interface InvestigationStore {
	/** Open the durable record before the stream starts. */
	create(): Promise<void>;
	/** Persist one canonical event (worker relays via Redis only → no-op). */
	append(event: CanonicalEvent): Promise<void>;
	/** Fold the synthesized report into the record + mark it done. */
	finish(report: InvestigationReport): Promise<void>;
	/** Mark the record failed (no-evidence branch or a thrown transport error). */
	fail(error: string): Promise<void>;
	/**
	 * Synchronously drain any buffered durable writes (optional). `finish`/`fail` own
	 * this drain on their own paths, but the `cancelled` outcome calls NEITHER — so
	 * `conductRun` invokes `flush` on cancel to force the buffered tail (incl. the
	 * terminal CANCELLED `error` event) out before it resolves. A store that persists
	 * synchronously (CLI/no-op) omits it.
	 */
	flush?(): Promise<void>;
}

export interface ConductedOutcome {
	runId: string;
	/** The synthesized report, or null when the branch gathered no evidence. */
	report: InvestigationReport | null;
	/** Failure message when no report was produced (no-evidence / transport / cancelled). */
	error: string | null;
	/**
	 * Which terminal path resolved: clean report, no-evidence, a thrown error, or a
	 * caller-requested `cancelled` (the run's AbortSignal fired mid-stream). On
	 * `cancelled` the STORE is left untouched — it has no cancel verb and its `fail`
	 * would record "failed", not "cancelled" — so the caller (the worker) owns the
	 * terminal "cancelled" status write from this outcome.
	 */
	failureKind: "none" | "no-evidence" | "error" | "cancelled";
}

/**
 * Run the investigation to completion, fanning each event to `sink` and driving
 * `store` through its lifecycle, and return the terminal outcome. Never throws on a
 * failed branch — a no-evidence / errored run resolves with `{ report: null, error,
 * failureKind }` after persisting the failure, so callers need no try/catch around
 * the stream.
 */
export async function conductRun(
	opts: InvestigateOptions,
	io: { sink: InvestigationSink; store: InvestigationStore },
): Promise<ConductedOutcome> {
	const runId = opts.runId ?? randomUUID();
	await io.store.create();

	let report: InvestigationReport | null = null;
	let lastError: string | null = null;
	let cancelled = false;
	try {
		for await (const event of investigateIncidentStream({ ...opts, runId })) {
			await io.sink(event);
			await io.store.append(event);
			if (event.kind === "report") report = event.report;
			else if (event.kind === "error") {
				lastError = event.message;
				// The stream's cancellation sentinel (an `error` event, no new contract
				// kind) — resolve a distinct `cancelled` outcome the caller persists as
				// status "cancelled", NOT store.fail's "failed".
				if (isCancelledError(event.message)) cancelled = true;
			}
		}
	} catch (err) {
		const msg = String((err as { message?: unknown } | null)?.message ?? err);
		await io.store.fail(msg);
		return { runId, report: null, error: msg, failureKind: "error" };
	}

	// Cancelled: the store gets no finish/fail (it has no cancel verb; the caller writes
	// the terminal "cancelled" record from this outcome). But a buffered store (the
	// worker's) would otherwise lose its unflushed tail — up to a batch of events INCL.
	// the terminal CANCELLED `error` event — to an unref'd fire-and-forget timer, so
	// drain it synchronously here before resolving.
	if (cancelled) {
		await io.store.flush?.();
		return { runId, report: null, error: lastError, failureKind: "cancelled" };
	}

	if (report) {
		await io.store.finish(report);
		return { runId, report, error: null, failureKind: "none" };
	}

	const err = lastError ?? "investigation produced no evidence";
	await io.store.fail(err);
	return { runId, report: null, error: err, failureKind: "no-evidence" };
}
