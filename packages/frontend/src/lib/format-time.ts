// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

const dateTime = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** One absolute timestamp format for the whole app: `3 Aug 2026, 11:00`. */
export function formatDateTime(value: string | number | Date): string {
	return dateTime.format(new Date(value));
}

export function formatDate(value: string | number | Date): string {
	return dateOnly.format(new Date(value));
}

/** A run's elapsed time: `38s`, `4m 12s`, `1h 02m`. */
export function formatElapsed(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	if (s < 60) return `${s}s`;
	if (s < 3600)
		return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
	return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

const clock = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

/** A time of day for in-run lines: `14:32`. */
export function formatClock(value: string | number | Date): string {
	return clock.format(new Date(value));
}

const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const WEEK = 6 * 86_400_000;

/** A time with its day when it is not today: `14:32`, `Mon 18:41`, and past a week `3 Aug 2026 18:41` (#981). */
export function formatDayClock(
	value: string | number | Date,
	now: number,
): string {
	const when = new Date(value);
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	const clockText = formatClock(when);
	if (when.getTime() >= start.getTime()) return clockText;
	if (start.getTime() - when.getTime() <= WEEK)
		return `${weekday.format(when)} ${clockText}`;
	return `${formatDate(when)} ${clockText}`;
}
