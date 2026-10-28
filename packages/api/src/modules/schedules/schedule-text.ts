// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import cronstrue from "cronstrue";
import { cronShape, nextSlots, type Recurrence } from "./recurrence.js";

const DAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];
const pad = (n: number) => String(n).padStart(2, "0");

/** "Every weekday at 09:00": the dialog's own words for its presets, cronstrue for the rest. */
export function describeRecurrence(r: Recurrence): string {
	if (r.type === "interval") {
		const m = r.everyMinutes;
		if (m % 60 === 0) return m === 60 ? "Every hour" : `Every ${m / 60} hours`;
		return `Every ${m} minutes`;
	}
	const [minute, hour, dom, month, dow] = r.expr.trim().split(/\s+/);
	if (cronShape(r.expr) === "fixed" && dom === "*" && month === "*") {
		const at = `${pad(Number(hour))}:${pad(Number(minute))}`;
		if (dow === "*") return `Every day at ${at}`;
		if (dow === "1-5") return `Every weekday at ${at}`;
		if (dow && /^[0-7]$/.test(dow))
			return `Every ${DAYS[Number(dow) % 7]} at ${at}`;
	}
	return cronstrue.toString(r.expr, {
		use24HourTimeFormat: true,
		verbose: false,
	});
}

function offsetMinutes(at: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
	}).formatToParts(at);
	const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
	const wall = Date.UTC(
		n("year"),
		n("month") - 1,
		n("day"),
		n("hour"),
		n("minute"),
	);
	return Math.round(
		(wall - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000,
	);
}

const wallClock = (at: Date, offset: number) => {
	const d = new Date(at.getTime() + offset * 60_000);
	return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** The next clock change within 30 days in this zone, if any. */
function nextChange(timeZone: string, from: Date) {
	const hour = 3_600_000;
	let before = offsetMinutes(from, timeZone);
	for (
		let t = from.getTime() + hour;
		t < from.getTime() + 30 * 24 * hour;
		t += hour
	) {
		const after = offsetMinutes(new Date(t), timeZone);
		if (after !== before) {
			let lo = t - hour;
			let hi = t;
			while (hi - lo > 60_000) {
				const mid = lo + Math.floor((hi - lo) / 2 / 60_000) * 60_000;
				if (offsetMinutes(new Date(mid), timeZone) === before) lo = mid;
				else hi = mid;
			}
			return { at: new Date(hi), before, after };
		}
		before = after;
	}
	return null;
}

/** What the next clock change does to this schedule, in a sentence; null when nothing changes (#979). */
export function dstNote(r: Recurrence, now: Date): string | null {
	if (r.type === "interval") return null;
	const change = nextChange(r.timezone, now);
	if (!change) return null;
	const day = new Intl.DateTimeFormat("en-GB", {
		timeZone: r.timezone,
		weekday: "short",
		day: "numeric",
		month: "short",
	}).format(change.at);
	const lead = `Clocks change in ${r.timezone} on ${day}.`;
	const oldWall = wallClock(change.at, change.before);
	const newWall = wallClock(change.at, change.after);
	if (cronShape(r.expr) === "fixed") {
		const [minute, hour] = r.expr.trim().split(/\s+/);
		const at = `${pad(Number(hour))}:${pad(Number(minute))}`;
		if (change.after > change.before && at >= oldWall && at < newWall)
			return `${lead} That day the ${at} run is at ${newWall}, the first time that exists.`;
		return `${lead} Runs stay at ${at} local time.`;
	}
	if (change.after < change.before) {
		const around = nextSlots(
			r,
			new Date(change.at.getTime() - 3_600_000),
			4,
		).filter((s) => Math.abs(s.getTime() - change.at.getTime()) < 3_600_000);
		if (around.length > 1)
			return `${lead} That day it runs twice between ${newWall} and ${oldWall}, once in each pass of the repeated hour.`;
	}
	return lead;
}
