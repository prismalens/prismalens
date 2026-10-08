// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	INCIDENT_ATTENTION_LABEL,
	INCIDENT_STATUS_LABEL,
	type IncidentStatus,
	type IncidentWithRelations,
	isIncidentOpen,
	isWorkflowLive,
	latestRun as newestRun,
	REFIRE_LABEL,
	RUN_STATE_LABEL,
	type RunState,
	runState,
} from "@prismalens/contracts";
import { failureWords } from "./failure-words";
import { formatClock, formatElapsed } from "./format-time";
import { attentionFor, attentionRank, isBackAgain } from "./incident-attention";
import { STALE_AFTER_S } from "./investigation-events";

export type BoardColumn = "needs_you" | "working" | "concluded" | "resolved";

export const BOARD_COLUMNS: { id: BoardColumn; label: string }[] = [
	{ id: "needs_you", label: "Needs you" },
	{ id: "working", label: "Working" },
	{ id: "concluded", label: "Concluded" },
	{ id: "resolved", label: "Resolved" },
];

type LatestRun = NonNullable<IncidentWithRelations["investigations"]>[number];

/** The newest run of any kind: a live chat is Working too (#673). */
export function latestRun(incident: IncidentWithRelations): LatestRun | null {
	return newestRun(incident);
}

/**
 * Which board column an incident sits in (R1a d6): what wants a human first,
 * even while its run is live, then a live run, then Resolved for the
 * operator's end, else Concluded. The list, the sidebar and the board all
 * read this one predicate.
 */
export function boardColumn(incident: IncidentWithRelations): BoardColumn {
	if (attentionFor(incident) !== null) return "needs_you";
	const run = latestRun(incident);
	if (run && isWorkflowLive(run.status)) return "working";
	if (!isIncidentOpen(incident.status)) return "resolved";
	return "concluded";
}

/** Needs you in its order; Alerts cleared last, under "To wrap up". Stable otherwise. */
export function orderNeedsYou(
	incidents: IncidentWithRelations[],
): IncidentWithRelations[] {
	return incidents
		.map((incident, i) => ({ incident, i, rank: attentionRank(incident) }))
		.sort((a, b) => a.rank - b.rank || a.i - b.i)
		.map((x) => x.incident);
}

/** Alerts cleared: the one Needs you kind that is paperwork, not fire. */
export function isWrapUp(incident: IncidentWithRelations): boolean {
	return attentionFor(incident) === "awaiting_close";
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

/** `0:21`, `14:02`, `1:02:09`: a run's elapsed time on a card. */
export function clockElapsed(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** `1m`, `41m`, `3h`, `2d`: an incident's age on a card, no "ago". */
export function shortAge(at: string | Date, now: number | null): string {
	if (now === null) return "";
	const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86_400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86_400)}d`;
}

export interface RunWord {
	state: RunState;
	/** What the agent is doing now, or the run word while it has said nothing. */
	step: string;
	/** Seconds since the run started; frozen at the last event while disconnected. */
	elapsed: number;
	/** Minutes since the last event, once past STALE_AFTER_S; null while it talks. */
	quietFor: number | null;
	/** `Working 14m, quiet for 5 min`: the whole line in the warning colour when quiet. */
	text: string;
}

/**
 * The live run's line on a card (study-v3 §3.1, §4): the step and its ticking
 * elapsed time; once the run goes quiet, "Working 14m, quiet for 5 min".
 */
export function runWord(
	incident: IncidentWithRelations,
	now: number | null,
): RunWord | null {
	const run = latestRun(incident);
	if (!run || !isWorkflowLive(run.status)) return null;
	const state = listRunState(run);
	const at = now ?? new Date(run.createdAt).getTime();
	const elapsed = (at - new Date(run.createdAt).getTime()) / 1000;
	const quiet =
		now !== null && run.lastEventAt
			? (now - new Date(run.lastEventAt).getTime()) / 1000
			: 0;
	const quietFor = quiet > STALE_AFTER_S ? Math.floor(quiet / 60) : null;
	const word = RUN_STATE_LABEL[state];
	const step =
		state === "working" && run.latestText ? firstClause(run.latestText) : word;
	const minutes = Math.max(0, Math.floor(elapsed / 60));
	return {
		state,
		step,
		elapsed,
		quietFor,
		text:
			quietFor !== null
				? `${word} ${minutes}m, quiet for ${quietFor} min`
				: `${step} ${clockElapsed(elapsed)}`,
	};
}

/** A column's state colour, repeated in its head, its cards and the sidebar (#673 w14). */
export const COLUMN_TONE: Record<
	BoardColumn,
	"warn" | "live" | "text-2" | "ok"
> = {
	needs_you: "warn",
	working: "live",
	concluded: "text-2",
	resolved: "ok",
};

/** `danger` for firing or failed, `warn` for the rest of Needs you, else plain. */
export type CardTone = "danger" | "warn" | "plain";

export interface CardWord {
	text: string;
	tone: CardTone;
	/** How long the state has held, or how long the run took: `54m`, `1m 02s`. */
	since?: string;
}

function since(at: string | Date | null | undefined, now: number | null) {
	return at ? shortAge(at, now) || undefined : undefined;
}

/** The card's state word (study-v3 §4): what is left to do, never the stored status. */
export function cardWord(
	incident: IncidentWithRelations,
	now: number | null = null,
): CardWord | null {
	const why = attentionFor(incident);
	if (why === "unacknowledged")
		return {
			text: isBackAgain(incident)
				? "Back again"
				: INCIDENT_ATTENTION_LABEL[why],
			tone: "danger",
		};
	if (why === "failed_run")
		return { text: INCIDENT_ATTENTION_LABEL[why], tone: "danger" };
	if (why === "awaiting_close")
		return {
			text: "Alerts cleared",
			tone: "plain",
			since: since(incident.resolvedAt, now),
		};
	if (why) return { text: INCIDENT_ATTENTION_LABEL[why], tone: "warn" };
	const column = boardColumn(incident);
	if (column === "resolved")
		return {
			text: "Resolved",
			tone: "plain",
			since: since(incident.closedAt, now),
		};
	if (column !== "concluded") return null;
	const run = latestRun(incident);
	const took =
		run && (run.startedAt || run.completedAt)
			? formatElapsed(
					(new Date(run.completedAt ?? run.createdAt).getTime() -
						new Date(run.startedAt ?? run.createdAt).getTime()) /
						1000,
				)
			: undefined;
	if (run?.status === "completed")
		return { text: "Done", tone: "plain", since: took };
	if (run?.status === "cancelled")
		return { text: "Stopped by you", tone: "plain", since: took };
	return {
		text:
			INCIDENT_STATUS_LABEL[incident.status as IncidentStatus] ??
			incident.status,
		tone: "plain",
	};
}

/**
 * Resolved cards older than a day fold into Settled under the columns, the
 * board's twin of the sidebar's Settled group (#673 w14).
 */
export function isSettled(
	incident: IncidentWithRelations,
	now: number,
): boolean {
	if (boardColumn(incident) !== "resolved") return false;
	const at = incident.closedAt ?? incident.updatedAt;
	return !!at && now - new Date(at).getTime() > 86_400_000;
}

export interface Headline {
	/** A leading word read in the foreground: `Likely:`, `Cause:`. */
	lead?: string;
	text: string;
}

const SAYS_NOTHING_NEW = new Set([
	"Starting…",
	"Working…",
	"Stopping…",
	"Run failed",
]);

/** Whether a headline tells more than the state word beside it (#743). */
export function headlineAddsInfo(h: Headline): boolean {
	return !!h.lead || !SAYS_NOTHING_NEW.has(h.text);
}

/**
 * The agent's one-line headline for a row or card (#743 §3c, R1a d6). Only
 * what the list payload carries: the latest run, the recorded cause.
 */
export function incidentHeadline(incident: IncidentWithRelations): Headline {
	const newest = latestRun(incident);
	// A live chat speaks; an ended one leaves the headline to the investigation (#673).
	const run =
		newest?.kind === "chat" && !isWorkflowLive(newest.status)
			? (newestRun(incident, { kind: "investigation" }) ?? newest)
			: newest;
	// A run started after Resolve speaks for the incident again.
	const endedAt = incident.closedAt ?? incident.resolvedAt;
	const runAfterEnd =
		!!run &&
		!!endedAt &&
		new Date(run.createdAt).getTime() > new Date(endedAt).getTime();
	if (incident.status === "closed" && !runAfterEnd) {
		return incident.actualCause
			? { lead: "Cause:", text: incident.actualCause }
			: { text: "No cause recorded" };
	}
	if (!run) return { text: "No investigation yet" };
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
			// A known failure in plain words, else the harness's own first line.
			return {
				text: run.error ? failureWords(run.error).what : "Run failed",
			};
		case "completed":
			return run.rootCause
				? { lead: "Likely:", text: run.rootCause }
				: { text: "Done, no cause named" };
		default:
			return { text: run.status };
	}
}

/**
 * Where this incident sits relative to its refires (R1a d5, d6): the incident
 * it fired again after, or the one that fired again after it.
 */
export function incidentLineage(
	incident: IncidentWithRelations,
): Headline | null {
	if (incident.mergedInto)
		return { lead: "Merged into", text: `INC-${incident.mergedInto.number}` };
	const after = incident.refiredAs;
	if (after && !isIncidentOpen(incident.status))
		return {
			lead: `${REFIRE_LABEL} as`,
			text: `INC-${after.number}, ${formatClock(after.createdAt)}`,
		};
	const prior = incident.priorIncident;
	if (prior && isIncidentOpen(incident.status)) {
		const ended =
			prior.status === "closed"
				? `after INC-${prior.number} was resolved`
				: `after INC-${prior.number}'s alerts cleared`;
		return {
			lead: `${REFIRE_LABEL}:`,
			text: prior.actualCause ? `${ended}, cause: ${prior.actualCause}` : ended,
		};
	}
	return null;
}

export type RowGlyph = "live" | "attention" | "open" | "ended";

/** The sidebar row's bar, from the board's column so the two never disagree (R1a d6). */
export function rowGlyph(incident: IncidentWithRelations): RowGlyph {
	switch (boardColumn(incident)) {
		case "needs_you":
			return "attention";
		case "working":
			return "live";
		case "resolved":
			return "ended";
		default:
			return "open";
	}
}

/** What Merge into… does, said before it is confirmed (#673 w37). */
export function mergeSentence(
	source: Pick<IncidentWithRelations, "number" | "alertCount">,
	target: Pick<IncidentWithRelations, "number" | "investigations">,
	service?: string,
): string {
	const n = source.alertCount;
	const moves = n === 1 ? "1 alert moves" : `${n} alerts move`;
	const base = `Its ${moves} to INC-${target.number} and INC-${source.number} ends as merged. Its runs stay here.`;
	const run = target.investigations?.[0];
	if (!run || !isWorkflowLive(run.status)) return base;
	const repos = service ? `the ${service} repositories` : "their repositories";
	return `${base} INC-${target.number}'s working run keeps its workspace; the next run also clones ${repos}.`;
}
