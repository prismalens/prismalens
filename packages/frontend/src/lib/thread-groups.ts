// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Local midnight `daysBack` calendar days before `t`; a DST day is 23 or 25 hours, so never subtract 24h. */
function startOfDay(t: number, daysBack = 0): number {
	const d = new Date(t);
	d.setDate(d.getDate() - daysBack);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

const MONTH = new Intl.DateTimeFormat("en-GB", {
	month: "long",
	year: "numeric",
});

/** The heading a thread's last activity falls under: Today, Yesterday, This week, then its month. */
export function dayGroup(at: number, now: number): string {
	if (at >= startOfDay(now)) return "Today";
	if (at >= startOfDay(now, 1)) return "Yesterday";
	if (at >= startOfDay(now, 6)) return "Earlier this week";
	return MONTH.format(new Date(at));
}

/** Rows already sorted newest first, cut into those headings in order. */
export function threadGroups<T extends { at: number }>(
	rows: readonly T[],
	now: number,
): { label: string; rows: T[] }[] {
	const out: { label: string; rows: T[] }[] = [];
	for (const r of rows) {
		const label = dayGroup(r.at, now);
		const last = out[out.length - 1];
		if (last?.label === label) last.rows.push(r);
		else out.push({ label, rows: [r] });
	}
	return out;
}

const CLOCK = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
});
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const DATE = new Intl.DateTimeFormat(undefined, {
	day: "numeric",
	month: "short",
});

/** A row's time at the right: the clock today, the weekday this week, else the date. */
export function rowWhen(at: number, now: number): string {
	if (at >= startOfDay(now)) return CLOCK.format(new Date(at));
	if (at >= startOfDay(now, 6)) return WEEKDAY.format(new Date(at));
	return DATE.format(new Date(at));
}
