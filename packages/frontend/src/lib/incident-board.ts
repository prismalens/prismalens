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
 * pane so a card and its row never disagree (#743 §3c). An open incident with
 * no live run and nothing asking for a human is Concluded, whatever its run did.
 */
export function boardColumn(incident: IncidentWithRelations): BoardColumn {
	if (attentionFor(incident) !== null) return "needs_you";
	const run = latestRun(incident);
	if (run && isWorkflowLive(run.status)) return "working";
	if (!isIncidentOpen(incident.status)) return "resolved";
	return "concluded";
}

/**
 * The run's own state for a list row or a board card. The list payload carries
 * no event count, so a claimed run reads Working (#743).
 */
export function listRunState(run: LatestRun): RunState {
	return runState(run.status, { hasEvents: run.status === "running" });
}

/** `Working 4m`: the run word with minutes since the run started, while live. */
export function runWord(
	incident: IncidentWithRelations,
	now: number | null,
): { state: RunState; text: string } | null {
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
	return { state, text: `${RUN_STATE_LABEL[state]} ${minutes}m` };
}

export interface Headline {
	/** A leading word read in the foreground: `Likely:`, `Cause:`. */
	lead?: string;
	text: string;
}

/**
 * The agent's one-line headline for a row or card (#743 §3c). Only what the
 * list payload carries: the latest run's status, its root cause and times.
 */
export function incidentHeadline(incident: IncidentWithRelations): Headline {
	const run = latestRun(incident);
	if (!isIncidentOpen(incident.status) && incident.actualCause) {
		return { lead: "Cause:", text: incident.actualCause };
	}
	if (!run) return { text: "No run yet" };
	switch (run.status) {
		case "pending":
			return { text: "Starting…" };
		case "running":
			return { text: "Working…" };
		case "cancelled":
			return {
				text: run.completedAt
					? `Stopped by you at ${formatClock(run.completedAt)}`
					: "Stopped by you",
			};
		case "failed":
			return { text: "Run failed" };
		case "completed":
			return run.rootCause
				? { lead: "Likely:", text: run.rootCause }
				: { text: "Done, no cause named" };
		default:
			return { text: run.status };
	}
}
