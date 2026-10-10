// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	awaitingApproval,
	type IncidentWithRelations,
	isAlertFiring,
	isWorkflowLive,
	latestRun,
	liveRun,
} from "@prismalens/contracts";
import { failureWords } from "@/lib/failure-words";
import { formatClock, formatElapsed } from "@/lib/format-time";
import { firstClause } from "@/lib/incident-board";

/** What an incident needs from you, the inbox's groups in their order (spec §1). */
export type NeedKey = "approval" | "ready" | "failed" | "nocause" | "cleared";

export type Tone = "accent" | "danger" | "warn" | "ok" | "live" | "plain";

export const NEED_GROUPS: {
	key: NeedKey;
	label: string;
	hint: string;
	tone: Tone;
}[] = [
	{
		key: "approval",
		label: "Waiting for your approval",
		hint: "A run is paused until you approve or deny a step.",
		tone: "danger",
	},
	{
		key: "ready",
		label: "Finding ready",
		hint: "A run found a cause worth reading.",
		tone: "accent",
	},
	{
		key: "failed",
		label: "Run failed or stopped",
		hint: "No finding yet. Retry, or close it if it is noise.",
		tone: "danger",
	},
	{
		key: "nocause",
		label: "No cause found",
		hint: "No run has named a cause yet.",
		tone: "warn",
	},
	{
		key: "cleared",
		label: "Alerts cleared",
		hint: "Nothing is firing. Close them, or find out why they fired.",
		tone: "ok",
	},
];

type Run = NonNullable<IncidentWithRelations["investigations"]>[number];

const HOUR = 3_600_000;
const time = (v: string | Date | null | undefined) =>
	v ? new Date(v).getTime() : Number.NaN;

/** The newest investigation that has ended, and the one with a named cause. */
function concluded(incident: IncidentWithRelations): {
	ended: Run | null;
	finding: Run | null;
} {
	const runs = (incident.investigations ?? [])
		.filter((r) => (r.kind ?? "investigation") === "investigation")
		.filter((r) => !isWorkflowLive(r.status))
		.sort((a, b) => time(b.createdAt) - time(a.createdAt));
	const [ended = null] = runs;
	return {
		ended,
		finding:
			ended?.status === "completed" && ended.rootCause?.trim() ? ended : null,
	};
}

/** The live investigation or chat, if one is working. */
export function liveOf(incident: IncidentWithRelations): Run | null {
	return liveRun(incident);
}

/** A working investigation; a live chat answers a question and asks nothing of the inbox. */
function liveInvestigation(incident: IncidentWithRelations): Run | null {
	return liveRun({
		investigations: (incident.investigations ?? []).filter(
			(r) => (r.kind ?? "investigation") === "investigation",
		),
	});
}

/**
 * Which inbox group an incident sits in, or null when nothing is asked of you:
 * a run is working on it with no finding yet, or it is resolved.
 */
export function needOf(incident: IncidentWithRelations): NeedKey | null {
	if (incident.status === "closed") return null;
	if (awaitingApproval(incident)) return "approval";
	if (incident.status === "resolved") return "cleared";
	const { ended, finding } = concluded(incident);
	if (finding) return "ready";
	if (liveInvestigation(incident)) return null;
	if (!ended || ended.status === "completed") return "nocause";
	return "failed";
}

export type Firing = "worse" | "steady" | "clear" | "none";

export const FIRING_LABEL: Record<Firing, string> = {
	worse: "Firing, worse",
	steady: "Firing, steady",
	clear: "Not firing",
	none: "No alert",
};

/** Firing alerts at `at`, from each alert's own start and end. */
function firingAt(incident: IncidentWithRelations, at: number): number {
	return (incident.alerts ?? []).filter((a) => {
		const from = time(a.triggeredAt);
		const to = a.resolvedAt ? time(a.resolvedAt) : Number.POSITIVE_INFINITY;
		return from <= at && at < to;
	}).length;
}

/** Hourly firing-alert counts over the last 24 hours, oldest first. */
export function firingSeries(
	incident: IncidentWithRelations,
	now: number,
): number[] {
	return Array.from({ length: 25 }, (_, i) =>
		firingAt(incident, now - (24 - i) * HOUR),
	);
}

/**
 * Whether the alerts are firing and which way they are going. Worse means
 * more alerts fire now than an hour ago, when some already fired: a new
 * incident's first alert is not a trend.
 */
export function firingOf(incident: IncidentWithRelations, now: number): Firing {
	const alerts = incident.alerts ?? [];
	if (incident.alertCount === 0 && alerts.length === 0) return "none";
	if (!alerts.some((a) => isAlertFiring(a.status))) return "clear";
	const before = firingAt(incident, now - HOUR);
	const current = firingAt(incident, now);
	return before > 0 && current > before ? "worse" : "steady";
}

/** Alerts that started firing in the last hour. */
export function newlyFiring(
	incident: IncidentWithRelations,
	now: number,
): number {
	return (incident.alerts ?? []).filter(
		(a) => isAlertFiring(a.status) && now - time(a.triggeredAt) < HOUR,
	).length;
}

/** The `points` of a 72 x 24 polyline; flat at the floor when nothing fired. */
export function sparkPoints(values: number[]): string {
	const max = Math.max(1, ...values);
	const step = 72 / Math.max(1, values.length - 1);
	return values
		.map(
			(v, i) => `${(i * step).toFixed(1)},${(22 - (v / max) * 19).toFixed(1)}`,
		)
		.join(" ");
}

export interface Reason {
	tag?: string;
	tagTone: Tone;
	text: string;
}

const sentence = (t: string) => t.replace(/[.\s]+$/, "");
const lowerFirst = (t: string) =>
	/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;

function took(run: Run): string | null {
	if (!run.completedAt) return null;
	const from = run.startedAt ?? run.createdAt;
	return formatElapsed((time(run.completedAt) - time(from)) / 1000);
}

/** The second line of a row: what happened, in a few words. */
export function reasonOf(
	incident: IncidentWithRelations,
	need: NeedKey,
	now: number,
): Reason {
	const { ended, finding } = concluded(incident);
	const live = liveInvestigation(incident);
	switch (need) {
		case "approval":
			return {
				tag: "Waiting:",
				tagTone: "danger",
				text: "the agent asks before it runs a step",
			};
		case "ready":
			return live
				? {
						tag: "Checking a follow-up.",
						tagTone: "live",
						text: `Likely: ${firstClause(finding?.rootCause ?? "")}`,
					}
				: {
						tag: "Likely:",
						tagTone: "accent",
						text: firstClause(finding?.rootCause ?? ""),
					};
		case "failed": {
			if (ended?.status === "cancelled") {
				const t = ended && took(ended);
				return {
					tag: "Stopped by you",
					tagTone: "danger",
					text: ended.completedAt
						? `at ${formatClock(ended.completedAt)}${t ? `, after ${t}` : ""}`
						: "",
				};
			}
			return {
				tag: "Failed:",
				tagTone: "danger",
				text: lowerFirst(sentence(failureWords(ended?.error).what)),
			};
		}
		case "nocause":
			return {
				tagTone: "warn",
				text: ended
					? "The last run found nothing that explains it"
					: "Not investigated yet",
			};
		case "cleared": {
			const refire = incident.refiredAs;
			if (refire)
				return {
					tag: `Same alert as INC-${refire.number}.`,
					tagTone: "ok",
					text: firedFor(incident),
				};
			const since = incident.resolvedAt ? ago(incident.resolvedAt, now) : null;
			return {
				tag: since ? `Cleared ${since} ago.` : "Cleared.",
				tagTone: "ok",
				text: finding
					? `Likely: ${firstClause(finding.rootCause ?? "")}`
					: ended
						? "No cause named"
						: "Never investigated",
			};
		}
	}
}

const DAY_CLOCK = new Intl.DateTimeFormat("en-US", {
	weekday: "short",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

/** `Fired Mon 21:40, cleared after 9h`. */
function firedFor(incident: IncidentWithRelations): string {
	const fired = `Fired ${DAY_CLOCK.format(new Date(incident.triggeredAt))}`;
	if (!incident.resolvedAt) return fired;
	const hours = Math.round(
		(time(incident.resolvedAt) - time(incident.triggeredAt)) / HOUR,
	);
	return `${fired}, cleared after ${hours < 1 ? "under an hour" : `${hours}h`}`;
}

/** `4m`, `13h`, `2d`. */
export function ago(at: string | Date, now: number): string {
	const s = Math.max(0, Math.round((now - time(at)) / 1000));
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86_400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86_400)}d`;
}

export type RowAction =
	| { kind: "open"; label: string; runId?: string }
	| { kind: "investigate"; label: string }
	| { kind: "resolve"; label: string }
	| { kind: "merge"; label: string; targetId: string };

/** The row's one button, and the quiet one beside it when the mockup shows two. */
export function actionsOf(
	incident: IncidentWithRelations,
	need: NeedKey,
	firing: Firing,
): { primary: RowAction; secondary?: RowAction } {
	const ran = !!latestRun(incident, { kind: "investigation" });
	switch (need) {
		case "approval":
			return {
				primary: {
					kind: "open",
					label: "Open",
					runId: liveOf(incident)?.id,
				},
			};
		case "ready":
			return { primary: { kind: "open", label: "Open" } };
		case "failed":
			return {
				primary: { kind: "investigate", label: "Retry run" },
				secondary:
					firing === "clear" || firing === "none"
						? { kind: "resolve", label: "Resolve" }
						: undefined,
			};
		case "nocause":
			return {
				primary: {
					kind: "investigate",
					label: ran ? "Investigate again" : "Investigate",
				},
			};
		case "cleared": {
			const refire = incident.refiredAs;
			if (refire)
				return {
					primary: {
						kind: "merge",
						label: `Merge into INC-${refire.number}`,
						targetId: refire.id,
					},
				};
			return {
				primary: { kind: "resolve", label: "Resolve" },
				secondary: ran
					? undefined
					: { kind: "investigate", label: "Investigate" },
			};
		}
	}
}

export interface Grouped {
	key: NeedKey;
	rows: IncidentWithRelations[];
}

/** Incidents into the inbox's groups, in group order, empty groups dropped. */
export function groupNeeds(incidents: IncidentWithRelations[]): Grouped[] {
	const by = new Map<NeedKey, IncidentWithRelations[]>();
	for (const incident of incidents) {
		const need = needOf(incident);
		if (!need) continue;
		by.set(need, [...(by.get(need) ?? []), incident]);
	}
	return NEED_GROUPS.flatMap((g) => {
		const rows = by.get(g.key);
		return rows ? [{ key: g.key, rows }] : [];
	});
}

/** The incident most clearly getting worse, for the first tile. */
export function gettingWorse(
	incidents: IncidentWithRelations[],
	now: number,
): IncidentWithRelations | null {
	return (
		incidents.find(
			(i) => i.status !== "closed" && firingOf(i, now) === "worse",
		) ?? null
	);
}

/** Lowercased text match on the ID, title and service, for the header filter. */
export function matches(incident: IncidentWithRelations, needle: string) {
	if (!needle) return true;
	return (
		incident.title.toLowerCase().includes(needle) ||
		`inc-${incident.number}`.includes(needle) ||
		(incident.service?.name ?? "").toLowerCase().includes(needle) ||
		(incident.service?.displayName ?? "").toLowerCase().includes(needle) ||
		(incident.services ?? []).some((s) =>
			(s.displayName ?? s.name).toLowerCase().includes(needle),
		)
	);
}
