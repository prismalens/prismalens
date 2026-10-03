// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What Analytics says about a window of incidents (study-v3 §3.6): the answer
 * line, four numbers with one line of comparison each, the secondary figures,
 * a bar per day and the two breakdowns. Pure, so the three kinds of month are
 * tested here, not on the screen.
 */

import {
	type IncidentWithRelations,
	isIncidentOpen,
	ROOT_CAUSE_CATEGORY_LABEL,
	type Severity,
} from "@prismalens/contracts";

const MINUTE = 60;
const DAY_MS = 86_400_000;

/** The middle value; null when there is none to take. */
export function median(values: number[]): number | null {
	const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
	if (sorted.length === 0) return null;
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[mid] as number)
		: Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

/** `6m`, `42m`, `1h 20m`, `2d 3h`: a tile's duration. */
export function shortDuration(seconds: number | null): string {
	if (seconds === null) return "none";
	const m = Math.round(seconds / MINUTE);
	if (m < 1) return `${Math.max(0, Math.round(seconds))}s`;
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
	const d = Math.floor(h / 24);
	return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** `6 minutes`, `1 hour 20 minutes`: the same duration in a sentence. */
export function longDuration(seconds: number): string {
	const m = Math.max(1, Math.round(seconds / MINUTE));
	if (m < 60) return plural(m, "minute");
	const h = Math.floor(m / 60);
	const rest = m % 60;
	return rest
		? `${plural(h, "hour")} ${plural(rest, "minute")}`
		: plural(h, "hour");
}

function plural(n: number, one: string, many = `${one}s`) {
	return `${n} ${n === 1 ? one : many}`;
}

/** The word for a window: month for 30 days, week for 7, quarter for 90. */
export function periodWord(days: number): string {
	return days <= 7 ? "week" : days <= 31 ? "month" : "quarter";
}

export interface WindowFigures {
	count: number;
	open: number;
	resolved: number;
	/** Seconds, median over incidents that carry each. */
	ack: number | null;
	/** First alert to the operator's Resolve (`timeToClose`). */
	resolve: number | null;
	/** First alert to the source clearing the alerts (`timeToResolve`). */
	cleared: number | null;
	investigated: number;
	causeNamed: number;
	/** Resolved incidents with a recorded category, and how many the agent's matched. */
	matchOf: number;
	matched: number;
}

function latestDone(i: IncidentWithRelations) {
	return i.investigations?.find((r) => r.status === "completed") ?? null;
}

export function windowFigures(
	incidents: IncidentWithRelations[],
): WindowFigures {
	const ended = incidents.filter((i) => i.status === "closed");
	const categorised = ended.filter(
		(i) => !!i.actualCauseCategory && !!latestDone(i)?.rootCauseCategory,
	);
	return {
		count: incidents.length,
		open: incidents.filter((i) => isIncidentOpen(i.status)).length,
		resolved: ended.length,
		ack: median(
			incidents.flatMap((i) =>
				i.timeToAcknowledge == null ? [] : [i.timeToAcknowledge],
			),
		),
		resolve: median(
			ended.flatMap((i) => (i.timeToClose == null ? [] : [i.timeToClose])),
		),
		cleared: median(
			incidents.flatMap((i) =>
				i.timeToResolve == null ? [] : [i.timeToResolve],
			),
		),
		investigated: incidents.filter((i) => (i.investigations?.length ?? 0) > 0)
			.length,
		causeNamed: incidents.filter((i) => !!latestDone(i)?.rootCause).length,
		matchOf: categorised.length,
		matched: categorised.filter(
			(i) => latestDone(i)?.rootCauseCategory === i.actualCauseCategory,
		).length,
	};
}

export type MonthKind = "empty" | "worse" | "active" | "quiet";

/**
 * Worse: clearly slower to acknowledge or to resolve than the window before.
 * More incidents alone is a busy month, not a worse one (the mocks' two cases).
 */
export function monthKind(
	now: WindowFigures,
	before: WindowFigures,
): MonthKind {
	if (now.count === 0) return "empty";
	// Slower by a quarter, and by a minute or twice over, so noise is not a worse month.
	const slower = (a: number | null, b: number | null) =>
		a !== null && b !== null && a > b * 1.25 && (a - b >= MINUTE || a >= 2 * b);
	if (slower(now.resolve, before.resolve) || slower(now.ack, before.ack))
		return "worse";
	return now.open > 0 ? "active" : "quiet";
}

export interface Answer {
	kind: MonthKind;
	/** The answer line; `needYou` is drawn as the link to Needs you. */
	lead: string;
	needYou: number | null;
	sub: string;
}

/** The answer line and the sentence under it, in the three kinds of month. */
export function answerLine(
	now: WindowFigures,
	before: WindowFigures,
	days: number,
	needYou: number,
): Answer {
	const kind = monthKind(now, before);
	const word = periodWord(days);
	if (kind === "empty")
		return {
			kind,
			lead: `No incidents in the last ${days} days`,
			needYou: null,
			sub: "",
		};
	const times = (() => {
		const parts: string[] = [];
		const was = (a: number | null, b: number | null) =>
			kind === "worse" && a !== null && b !== null && a !== b
				? `, ${a > b ? "up" : "down"} from ${shortDuration(b)}`
				: "";
		if (now.ack !== null)
			parts.push(
				`${longDuration(now.ack)} to acknowledge${was(now.ack, before.ack)}`,
			);
		if (now.resolve !== null)
			parts.push(
				`${longDuration(now.resolve)} to resolve${was(now.resolve, before.resolve)}`,
			);
		return parts.length
			? `Median ${parts.join(" and ")}.`
			: "Nothing resolved yet.";
	})();
	const agent =
		now.investigated === 0
			? "The agent investigated none of them."
			: `The agent investigated ${now.investigated === now.count ? `all ${now.count}` : `${now.investigated} of ${now.count}`}; it named a cause ${now.causeNamed === now.investigated && now.causeNamed > 1 ? (now.causeNamed === 2 ? "both times" : "every time") : plural(now.causeNamed, "time")}.`;
	const sub = `${times} ${agent}`;
	if (kind === "worse") {
		const slower =
			now.resolve !== null &&
			before.resolve !== null &&
			now.resolve > before.resolve;
		return {
			kind,
			lead: `Worse than last ${word}: ${plural(now.count, "incident")}, ${now.count > before.count ? "up" : "down"} from ${before.count}${slower ? ", and slower to resolve" : ""}.`,
			needYou: null,
			sub,
		};
	}
	if (kind === "active")
		return {
			kind,
			lead: `${now.count >= 5 || now.open >= 3 ? "Busy" : "This"} ${word}: ${plural(now.count, "incident")}, ${now.open} still open.`,
			needYou,
			sub,
		};
	return {
		kind,
		lead: `A quiet ${word}: ${plural(now.count, "incident")}, ${now.resolved === now.count ? "all resolved" : `${now.resolved} resolved`}.`,
		needYou: null,
		sub,
	};
}

export interface Tile {
	key: "incidents" | "ack" | "resolve" | "investigated" | "open";
	value: string;
	label: string;
	/** One line of comparison or meaning. */
	line: string;
}

function compareCount(now: number, before: number, days: number): string {
	if (before === now) return `same as the ${days} days before`;
	const diff = Math.abs(now - before);
	return `${diff} ${now > before ? "more" : "fewer"} than the ${days} days before`;
}

function compareTime(
	now: number | null,
	before: number | null,
	fallback: string,
): string {
	if (now === null || before === null || now === before) return fallback;
	return `${now > before ? "up" : "down"} from ${shortDuration(before)}`;
}

/** The numbers under the answer, each with one line (study-v3 §3.6). */
export function tiles(
	now: WindowFigures,
	before: WindowFigures,
	days: number,
	openNow: number,
	needYou: number,
	kind: MonthKind,
): Tile[] {
	const worse = kind === "worse";
	return [
		{
			key: "incidents",
			value: String(now.count),
			label: "Incidents",
			line:
				worse && now.count !== before.count
					? `${now.count > before.count ? "up" : "down"} from ${before.count}`
					: compareCount(now.count, before.count, days),
		},
		{
			key: "ack",
			value: shortDuration(now.ack),
			label: "Median time to acknowledge",
			line: compareTime(now.ack, before.ack, "paging to first human"),
		},
		{
			key: "resolve",
			value: shortDuration(now.resolve),
			label: "Median time to resolve",
			line: compareTime(
				now.resolve,
				before.resolve,
				"first alert to your Resolve",
			),
		},
		{
			key: "investigated",
			value: String(now.investigated),
			label: "Investigated by the agent",
			line:
				before.count > 0
					? `${before.investigated} of ${before.count} the ${days} days before`
					: `of ${plural(now.count, "incident")}`,
		},
		{
			key: "open",
			value: String(openNow),
			label: "Open now",
			line:
				needYou > 0
					? `${needYou} need${needYou === 1 ? "s" : ""} you`
					: "nothing needs you",
		},
	];
}

export interface DayBar {
	day: string;
	count: number;
	/** The worst severity that day, for the bar's colour. */
	severity: Severity | null;
}

const SEVERITY_ORDER: Severity[] = [
	"critical",
	"high",
	"medium",
	"low",
	"info",
];

/** One bar per day of the window, oldest first, coloured by the day's worst severity. */
export function dayBars(
	incidents: IncidentWithRelations[],
	days: number,
	nowMs: number,
): DayBar[] {
	const start = new Date(nowMs);
	start.setHours(0, 0, 0, 0);
	const first = start.getTime() - (days - 1) * DAY_MS;
	const bars: DayBar[] = Array.from({ length: days }, (_, i) => ({
		day: new Date(first + i * DAY_MS).toISOString(),
		count: 0,
		severity: null,
	}));
	for (const i of incidents) {
		const at = new Date(i.triggeredAt);
		at.setHours(0, 0, 0, 0);
		const bar = bars[Math.round((at.getTime() - first) / DAY_MS)];
		if (!bar) continue;
		bar.count += 1;
		if (
			bar.severity === null ||
			SEVERITY_ORDER.indexOf(i.severity) < SEVERITY_ORDER.indexOf(bar.severity)
		)
			bar.severity = i.severity;
	}
	return bars;
}

export interface Share {
	key: string;
	label: string;
	count: number;
}

/** Incidents per service, most first. */
export function byService(incidents: IncidentWithRelations[]): Share[] {
	const out = new Map<string, Share>();
	for (const i of incidents) {
		const s = i.service ?? i.services?.[0];
		const key = s?.id ?? "none";
		const label = s ? s.displayName || s.name : "No service";
		const row = out.get(key) ?? { key, label, count: 0 };
		row.count += 1;
		out.set(key, row);
	}
	return Array.from(out.values()).sort((a, b) => b.count - a.count);
}

/** Resolved incidents per recorded cause category, most first. */
export function byRecordedCause(incidents: IncidentWithRelations[]): Share[] {
	const out = new Map<string, Share>();
	for (const i of incidents.filter((x) => x.status === "closed")) {
		const key = i.actualCauseCategory ?? "none";
		const label = i.actualCauseCategory
			? ROOT_CAUSE_CATEGORY_LABEL[i.actualCauseCategory]
			: "No cause recorded";
		const row = out.get(key) ?? { key, label, count: 0 };
		row.count += 1;
		out.set(key, row);
	}
	return Array.from(out.values()).sort((a, b) => b.count - a.count);
}
