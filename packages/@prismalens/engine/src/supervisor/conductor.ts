/**
 * Conduct one investigation: drive the supervisor stream, fan every canonical
 * event to a SINK, and return the terminal outcome. The sink is the only thing
 * that varies across runtimes:
 *
 *   - CLI `investigate`  → render a terminal timeline line
 *   - CLI `serve`        → emit a JSON-RPC `investigate/event` notification
 *   - web worker         → publish to the Redis stream channel (→ SSE → UI)
 *   - standalone         → append to the `~/.prismalens` events file
 *
 * Collapses the drive-loop + no-evidence outcome logic that was otherwise
 * duplicated across each consumer (architecture-review candidate #2).
 *
 * Persistence LIFECYCLE (create/update a session or a DB row) stays with the
 * CALLER because it varies (file vs DB vs none); the conductor owns only the
 * stream, the sink fan-out, and deriving `{ report | error }`. The no-evidence
 * guard lives in {@link investigateIncidentStream} — it simply emits no `report`
 * event when a branch gathered nothing, so `report` stays null here.
 */
import { randomUUID } from "node:crypto";
import type { CanonicalEvent, InvestigationReport } from "@prismalens/contracts";
import {
	type InvestigateOptions,
	investigateIncidentStream,
} from "./investigate.js";

/** Receives every canonical event as it streams. May be async (awaited in order). */
export type InvestigationSink = (
	event: CanonicalEvent,
) => void | Promise<void>;

export interface ConductedOutcome {
	runId: string;
	/** The synthesized report, or null when the branch gathered no evidence. */
	report: InvestigationReport | null;
	/** Failure message when no report was produced (no-evidence / transport error). */
	error: string | null;
}

/**
 * Run the investigation to completion, fanning each event to `sink`, and return
 * the terminal outcome. Never throws on a failed branch — a no-evidence / errored
 * run resolves with `{ report: null, error }` so callers can persist the failure
 * without a try/catch around the stream.
 */
export async function conductInvestigation(
	opts: InvestigateOptions,
	sink: InvestigationSink,
): Promise<ConductedOutcome> {
	const runId = opts.runId ?? randomUUID();
	let report: InvestigationReport | null = null;
	let lastError: string | null = null;

	for await (const event of investigateIncidentStream({ ...opts, runId })) {
		await sink(event);
		if (event.kind === "report") report = event.report;
		else if (event.kind === "error") lastError = event.message;
	}

	return {
		runId,
		report,
		error: report ? null : (lastError ?? "investigation produced no evidence"),
	};
}
