// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

const pad = (n: number) => String(n).padStart(2, "0");

function sameDay(a: Date, b: Date) {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

/** "today, 21:00", "Mon 2 Nov, 09:00": the viewer's own clock, as every other date in the app. */
export function whenText(iso: string | null, now = new Date()): string {
	if (!iso) return "";
	const d = new Date(iso);
	const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	if (sameDay(d, now)) return `today, ${time}`;
	const day = new Intl.DateTimeFormat("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
	}).format(d);
	return `${day}, ${time}`;
}

export const clock = (iso: string) => {
	const d = new Date(iso);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** "Next on Mon 2 Nov at 09:00, then Tue 3 Nov." in the schedule's own zone. */
export function nextRunsText(next: string[], timeZone: string): string | null {
	const [first, second] = next;
	if (!first) return null;
	const day = (iso: string) =>
		new Intl.DateTimeFormat("en-GB", {
			timeZone,
			weekday: "short",
			day: "numeric",
			month: "short",
		}).format(new Date(iso));
	const time = (iso: string) =>
		new Intl.DateTimeFormat("en-GB", {
			timeZone,
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		}).format(new Date(iso));
	const then = second
		? day(second) === day(first)
			? `, then ${time(second)}`
			: `, then ${day(second)}`
		: "";
	return `Next on ${day(first)} at ${time(first)}${then}.`;
}

export function durationText(from: string | null, to: string | null): string {
	if (!from || !to) return "";
	const min = Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
	return min < 60 ? `${Math.max(min, 1)} min` : `${Math.round(min / 60)} h`;
}
