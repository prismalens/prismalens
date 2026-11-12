// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HARNESS_REGISTRY } from "@prismalens/config/harness";
import {
	type LimitWindow,
	type UsageTokens,
	type UsageWindow,
	usageWindowState,
} from "@prismalens/contracts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** An agent id's name, or the id when the registry does not know it. */
export function agentName(id: string): string {
	const known = HARNESS_REGISTRY as Record<
		string,
		{ label: string } | undefined
	>;
	return known[id]?.label ?? id;
}

/** Names joined for a sentence: "Codex", "Codex and OpenCode". */
export function listNames(names: string[]): string {
	return new Intl.ListFormat("en", { type: "conjunction" }).format(names);
}

/** `840`, `12.3K`, `1.2M`, `3B`. */
export function formatTokens(n: number): string {
	const units: [number, string][] = [
		[1e9, "B"],
		[1e6, "M"],
		[1e3, "K"],
	];
	for (const [size, suffix] of units) {
		if (n >= size) {
			const v = n / size;
			const text = v >= 100 ? v.toFixed(0) : v.toFixed(1);
			return `${text.replace(/\.0$/, "")}${suffix}`;
		}
	}
	return String(Math.round(n));
}

/** A reported cost; null is "Unpriced", never $0. A cost under a cent reads `<$0.01`. */
export function formatCost(amount: number | null, currency = "USD"): string {
	if (amount === null) return "Unpriced";
	const money = new Intl.NumberFormat("en", {
		style: "currency",
		currency,
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
	if (amount > 0 && amount < 0.01) return `<${money.format(0.01)}`;
	return money.format(amount);
}

/** `part / whole`, 0 when the whole is 0. */
export function share(part: number, whole: number): number {
	return whole > 0 ? part / whole : 0;
}

/** A 0..1 share as `42%`; a share above 0 but under 1% reads `<1%`. */
export function formatShare(fraction: number): string {
	if (fraction > 0 && fraction < 0.01) return "<1%";
	return `${Math.round(fraction * 100)}%`;
}

/** Cache reads over all input read (fresh plus cached); null when no cache read was reported. */
export function cacheHitRate(tokens: UsageTokens): number | null {
	if (tokens.cacheRead === 0) return null;
	return tokens.cacheRead / (tokens.input + tokens.cacheRead);
}

/** Cost per million tokens; null when unpriced or no tokens. */
export function costPerMillion(
	amount: number | null,
	totalTokens: number,
): number | null {
	if (amount === null || totalTokens === 0) return null;
	return (amount / totalTokens) * 1e6;
}

/** `100 - usedPercent`, or null when the agent gave no percent. */
export function percentLeft(usedPercent: number | null): number | null {
	if (usedPercent === null) return null;
	return Math.max(0, Math.min(100, 100 - usedPercent));
}

export const WINDOW_MS: Record<LimitWindow, number> = {
	session: 5 * HOUR_MS,
	daily: DAY_MS,
	weekly: 7 * DAY_MS,
	monthly: 30 * DAY_MS,
	model: 7 * DAY_MS,
};

/** The share of the window already elapsed, 0..1; null without a reset time or a known length. */
export function paceElapsed(
	window: LimitWindow | null,
	resetsAt: string | null,
	now: number,
): number | null {
	if (!window || !resetsAt) return null;
	const left = Date.parse(resetsAt) - now;
	return Math.max(0, Math.min(1, 1 - left / WINDOW_MS[window]));
}

/** How usage compares with the clock: more used than elapsed (by 5 points or more) is ahead. */
export function paceWord(
	usedPercent: number | null,
	elapsed: number | null,
): "Ahead of pace" | "On pace" | null {
	if (usedPercent === null || elapsed === null) return null;
	return usedPercent >= elapsed * 100 + 5 ? "Ahead of pace" : "On pace";
}

/** Time until a moment: `2h 39m`, `3d 4h`, `12m`; `now` once it has passed. */
export function formatUntil(iso: string, now: number): string {
	const ms = Date.parse(iso) - now;
	if (ms <= 0) return "now";
	const mins = Math.ceil(ms / 60_000);
	const d = Math.floor(mins / 1440);
	const h = Math.floor((mins % 1440) / 60);
	const m = mins % 60;
	if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
	if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
	return `${m}m`;
}

const WINDOW_WORD: Record<LimitWindow, string> = {
	session: "Session, 5 hours",
	daily: "Daily",
	weekly: "Weekly",
	monthly: "Monthly",
	model: "Weekly",
};

/** A window's name: "Session, 5 hours", "Weekly", "Weekly, Opus" for a per-model window. */
export function windowLabel(w: Pick<UsageWindow, "window" | "type">): string {
	if (w.window === "model") {
		const model = w.type?.replace(/^(seven_day|weekly)_?/, "");
		if (!model) return WINDOW_WORD.model;
		return `${WINDOW_WORD.model}, ${model.charAt(0).toUpperCase()}${model.slice(1).replaceAll("_", " ")}`;
	}
	if (w.window) return WINDOW_WORD[w.window];
	const words = (w.type ?? "Usage window").replaceAll("_", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A bucket key on the chart: `12 Nov` for a UTC day, `14:00` local for an hour. */
export function bucketLabel(key: string, step: "hour" | "day"): string {
	if (step === "day")
		return new Intl.DateTimeFormat(undefined, {
			day: "numeric",
			month: "short",
			timeZone: "UTC",
		}).format(new Date(`${key}T00:00:00Z`));
	return new Intl.DateTimeFormat(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(new Date(key));
}

type Reported = "cache" | "cost" | "limits";
/** What each agent's adapter forwards over ACP besides tokens (pattern sheet §7). */
const REPORTS: Record<string, readonly Reported[]> = {
	"claude-code": ["cache", "cost", "limits"],
	codex: ["cache"],
	opencode: [],
	gemini: [],
};

/** An agent's missing usage data in a few words; null when it reports all of it or is unknown. */
export function agentGap(id: string): string | null {
	const has = REPORTS[id];
	if (!has) return null;
	if (has.length === 0) return "Tokens only";
	const missing = (["cost", "limits"] as const).filter((r) => !has.includes(r));
	if (missing.length === 0) return null;
	return `No ${missing.join(" or ")}`;
}

/** A reset as a day, time and zone: `Thu 17:54 GMT+1`. */
export function formatResetAt(iso: string): string {
	return new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		timeZoneName: "short",
	}).format(new Date(iso));
}

/** "1 turn", "3 turns". */
export function countOf(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}

type Warnable = Pick<
	UsageWindow,
	"usedPercent" | "status" | "resetsAt" | "window" | "type"
>;

/**
 * The window the composer warns on before a turn: full beats near, then the
 * most used. The Limited stop's own rule (`usageWindowState`) decides both, and
 * a window whose reset has passed counts for neither; null when all have room.
 */
export function warnWindow<W extends Warnable>(
	windows: readonly W[],
	now: number,
): W | null {
	let worst: W | null = null;
	let rank = 0;
	for (const w of windows) {
		if (w.resetsAt && Date.parse(w.resetsAt) <= now) continue;
		const state = usageWindowState(w);
		const r = state === "full" ? 2 : state === "near" ? 1 : 0;
		if (
			r > rank ||
			(r > 0 && r === rank && (w.usedPercent ?? 0) > (worst?.usedPercent ?? 0))
		) {
			worst = w;
			rank = r;
		}
	}
	return worst;
}

/** The warning ring's hint: "Weekly: 94% used, resets Thu 17:54 GMT+1 (in 2d 3h)". */
export function warnHint(w: Warnable, now: number): string {
	const full = usageWindowState(w) === "full";
	const used =
		w.usedPercent === null
			? full
				? "limit reached"
				: "near the limit"
			: `${Math.round(w.usedPercent)}% used`;
	const reset = w.resetsAt
		? `, resets ${formatResetAt(w.resetsAt)} (in ${formatUntil(w.resetsAt, now)})`
		: "";
	return `${windowLabel(w)}: ${used}${reset}`;
}
