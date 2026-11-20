// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * How a usage-limit error opens. Claude's: claude-agent-sdk 0.3.304
 * `USAGE_LIMIT_ERROR_PREFIXES`; Codex's: the text of its `usageLimitExceeded` error;
 * Gemini CLI's: its terminal quota errors (`googleQuotaErrors.ts`).
 */
const LIMIT_OPENINGS = [
	"you've hit your",
	"you've reached your",
	"you're out of usage credits",
	"you're out of extra usage",
	"your org is out of usage",
	"your seat type doesn't include usage",
	"your seat type doesn't include extra usage",
	"your usage allocation has been disabled",
	"your group's usage limit is set to $0",
	"requires usage credits",
	"usage limit reached",
	"quota_exhausted",
	"exhausted your daily quota",
	"exhausted your quota",
];

/** A retry the agent makes itself; shorter than this is a rate error, not a limit (#1024). */
export const SHORT_RETRY_MS = 5 * 60 * 1000;

function plain(text: string): string {
	return text.replace(/[‘’]/g, "'").toLowerCase();
}

/** The agent stopped because its account ran out of usage, not because the run went wrong. */
export function isUsageLimitError(text: string | null | undefined): boolean {
	if (!text) return false;
	const said = plain(text);
	if (LIMIT_OPENINGS.some((opening) => said.includes(opening))) return true;
	// Gemini's "Please retry in Xs": only a wait of five minutes or more is a limit.
	const wait = retryInMs(text);
	return wait !== null && wait >= SHORT_RETRY_MS && /quota|limit/.test(said);
}

/**
 * The limit text an agent's JSON-RPC error carries: its message, or a message
 * nested in its `data` (Codex sends one under a generic "Internal error").
 */
export function usageLimitText(
	message: string,
	data: string | undefined,
): string | null {
	if (isUsageLimitError(message)) return message;
	if (!data) return null;
	const quoted = /"message":("(?:[^"\\]|\\.)*")/.exec(data)?.[1];
	let said: string | null = null;
	try {
		said = quoted ? (JSON.parse(quoted) as string) : null;
	} catch {
		said = null;
	}
	if (said && isUsageLimitError(said)) return said;
	return data.includes("usageLimitExceeded")
		? `Usage limit reached: ${message}`
		: null;
}

/** Gemini CLI's "Please retry in 23.5s" (also ms and m), in milliseconds. */
export function retryInMs(text: string): number | null {
	const m = /retry in\s+([\d.]+)\s*(ms|s|m|min|minutes?|seconds?)\b/i.exec(
		text,
	);
	if (!m) return null;
	const n = Number(m[1]);
	if (!Number.isFinite(n)) return null;
	const unit = (m[2] as string).toLowerCase();
	return unit === "ms" ? n : unit.startsWith("m") ? n * 60_000 : n * 1000;
}

const MONTHS = [
	"jan",
	"feb",
	"mar",
	"apr",
	"may",
	"jun",
	"jul",
	"aug",
	"sep",
	"oct",
	"nov",
	"dec",
];

function clock(h: string, min: string, ampm: string): [number, number] | null {
	let hour = Number(h);
	const minute = Number(min);
	if (hour < 1 || hour > 12 || minute > 59) return null;
	if (ampm.toLowerCase() === "pm" && hour !== 12) hour += 12;
	if (ampm.toLowerCase() === "am" && hour === 12) hour = 0;
	return [hour, minute];
}

/**
 * When the agent says its limit resets, in local time; null when it names no time.
 * Codex: "try again at 3:45 PM" (the next such time) or "Nov 7th, 2026 3:45 PM"
 * (codex-rs protocol error.rs); Gemini CLI: "Please retry in Xs", five minutes or more;
 * Claude: "resets 6:10am (Europe/London)", the next such time in that zone (#1101).
 */
export function parseReset(
	text: string,
	now: Date,
	_agent?: string | null,
): Date | null {
	const dated =
		/try again at\s+([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*([ap]m)/i.exec(
			text,
		);
	if (dated) {
		const month = MONTHS.indexOf((dated[1] as string).toLowerCase());
		const at = clock(
			dated[4] as string,
			dated[5] as string,
			dated[6] as string,
		);
		if (month < 0 || !at) return null;
		return new Date(
			Number(dated[3]),
			month,
			Number(dated[2]),
			at[0],
			at[1],
			0,
			0,
		);
	}
	const timed = /try again at\s+(\d{1,2}):(\d{2})\s*([ap]m)/i.exec(text);
	if (timed) {
		const at = clock(
			timed[1] as string,
			timed[2] as string,
			timed[3] as string,
		);
		if (!at) return null;
		const d = new Date(now);
		d.setHours(at[0], at[1], 0, 0);
		if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
		return d;
	}
	const resets =
		/\bresets\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)(?:\s*\(([A-Za-z_]+(?:\/[A-Za-z_+-]+)+|UTC)\))?/i.exec(
			text,
		);
	if (resets) {
		const at = clock(
			resets[1] as string,
			resets[2] ?? "00",
			resets[3] as string,
		);
		if (!at) return null;
		return nextWallClock(at[0], at[1], resets[4], now);
	}
	const wait = retryInMs(text);
	if (wait !== null && wait >= SHORT_RETRY_MS)
		return new Date(now.getTime() + Math.ceil(wait));
	return null;
}

/** The zone's wall clock at `t`, read as if it were UTC, in ms. */
function wallAsUtc(t: number, zone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: zone,
		hourCycle: "h23",
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
	}).formatToParts(new Date(t));
	const n = (type: string) =>
		Number(parts.find((p) => p.type === type)?.value ?? 0);
	return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"));
}

/** The next `hour:minute` after `now` in `zone`, or in local time when the zone is absent or unknown. */
function nextWallClock(
	hour: number,
	minute: number,
	zone: string | undefined,
	now: Date,
): Date {
	const local = () => {
		const d = new Date(now);
		d.setHours(hour, minute, 0, 0);
		if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
		return d;
	};
	if (!zone) return local();
	try {
		const today = new Date(wallAsUtc(now.getTime(), zone));
		for (const plus of [0, 1]) {
			const wall = Date.UTC(
				today.getUTCFullYear(),
				today.getUTCMonth(),
				today.getUTCDate() + plus,
				hour,
				minute,
			);
			// Two passes settle the zone's offset, a DST change included.
			let t = wall - (wallAsUtc(wall, zone) - wall);
			t = wall - (wallAsUtc(t, zone) - t);
			if (t > now.getTime()) return new Date(t);
		}
	} catch {
		return local();
	}
	return local();
}
