// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type IncidentWithRelations,
	isIncidentOpen,
	isWorkflowLive,
	RUN_STATE_LABEL,
	type RunState,
	runState,
} from "@prismalens/contracts";
import { formatClock } from "./format-time";
import { attentionFor } from "./incident-attention";
import { STALE_AFTER_S } from "./investigation-events";

export type BoardColumn = "needs_you" | "working" | "concluded" | "resolved";

export const BOARD_COLUMNS: { id: BoardColumn; label: string }[] = [
	{ id: "needs_you", label: "Needs you" },
	{ id: "working", label: "Working" },
	{ id: "concluded", label: "Concluded" },
	{ id: "resolved", label: "Resolved" },
];

type LatestRun = NonNullable<IncidentWithRelations["investigations"]>[number];

export function latestRun(incident: IncidentWithRelations): LatestRun | null {
	return incident.investigations?.[0] ?? null;
}

/**
 * Which board column an incident sits in, from the same predicates as the list
 * pane so a card and its row never disagree (#743 §3c). A live run puts it in
 * Working whatever its status; an open incident with no live run and nothing
 * asking for a human is Concluded, whatever its run did.
 */
export function boardColumn(incident: IncidentWithRelations): BoardColumn {
	const run = latestRun(incident);
	if (run && isWorkflowLive(run.status)) return "working";
	if (attentionFor(incident) !== null) return "needs_you";
	if (!isIncidentOpen(incident.status)) return "resolved";
	return "concluded";
}

/** The run's own state for a list row or a board card (#743 §2). */
export function listRunState(run: LatestRun): RunState {
	return runState(run.status, {
		hasEvents: !!run.lastEventAt,
		stopRequested: !!run.stopRequestedAt,
	});
}

/** The first clause of the agent's latest sentence, for a one-line headline. */
export function firstClause(text: string): string {
	const line = text.trim().split("\n")[0] ?? "";
	const cut = line.search(/[.;:](\s|$)/);
	return cut > 0 ? line.slice(0, cut) : line;
}

/** `Working 4m`: the run word with minutes since the run started, while live. */
export function runWord(
	incident: IncidentWithRelations,
	now: number | null,
): { state: RunState; text: string; stale: boolean } | null {
	const run = latestRun(incident);
	if (!run || !isWorkflowLive(run.status)) return null;
	const state = listRunState(run);
	const minutes =
		now === null
			? 0
			: Math.max(
					0,
					Math.floor((now - new Date(run.createdAt).getTime()) / 60_000),
				);
	const stale =
		now !== null &&
		!!run.lastEventAt &&
		now - new Date(run.lastEventAt).getTime() > STALE_AFTER_S * 1000;
	return { state, text: `${RUN_STATE_LABEL[state]} ${minutes}m`, stale };
}

export interface Headline {
	/** A leading word read in the foreground: `Likely:`, `Cause:`. */
	lead?: string;
	text: string;
}

const SAYS_NOTHING_NEW = new Set([
	"No run yet",
	"Starting…",
	"Working…",
	"Stopping…",
	"Run failed",
	"Done, no cause named",
]);

/** Whether a headline tells more than the state word beside it (#743). */
export function headlineAddsInfo(h: Headline): boolean {
	return !!h.lead || !SAYS_NOTHING_NEW.has(h.text);
}

/**
 * The agent's one-line headline for a row or card (#743 §3c). Only what the
 * list payload carries: the latest run's status, its root cause and times.
 */
export function incidentHeadline(incident: IncidentWithRelations): Headline {
	const run = latestRun(incident);
	// A run started after the incident was resolved speaks for it again.
	const runAfterResolve =
		!!run &&
		!!incident.resolvedAt &&
		new Date(run.createdAt).getTime() > new Date(incident.resolvedAt).getTime();
	if (
		!isIncidentOpen(incident.status) &&
		incident.actualCause &&
		!runAfterResolve
	) {
		return { lead: "Cause:", text: incident.actualCause };
	}
	if (!run) return { text: "No run yet" };
	switch (run.status) {
		case "pending":
			return { text: run.stopRequestedAt ? "Stopping…" : "Starting…" };
		case "running":
			if (run.stopRequestedAt) return { text: "Stopping…" };
			if (!run.lastEventAt) return { text: "Starting…" };
			return {
				text: run.latestText ? firstClause(run.latestText) : "Working…",
			};
		case "cancelled":
			return {
				text: run.completedAt
					? `Stopped by you at ${formatClock(run.completedAt)}`
					: "Stopped by you",
			};
		case "failed":
			return {
				text: run.error
					? `Run failed: ${firstClause(run.error)}`
					: "Run failed",
			};
		case "completed":
			return run.rootCause
				? {
						lead: "Likely:",
						text: run.evidenceCount
							? `${run.rootCause}, ${run.evidenceCount} evidence`
							: run.rootCause,
					}
				: { text: "Done, no cause named" };
		default:
			return { text: run.status };
	}
}
