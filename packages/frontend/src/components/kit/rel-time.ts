// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * The app's one relative time (#1101 cat 3): "now", "5m", "3h", "2d" for the
 * past and "in 5m" for the future, so a reader never confuses an age with a
 * clock. The exact time rides in the `Time` hint. `now` null renders "".
 */
export function relTime(
	at: string | number | Date,
	now: number | null,
): string {
	if (now === null) return "";
	const t = new Date(at).getTime();
	if (Number.isNaN(t)) return "";
	const d = t - now;
	const ms = Math.abs(d);
	const word =
		ms < MIN
			? null
			: ms < HOUR
				? `${Math.floor(ms / MIN)}m`
				: ms < DAY
					? `${Math.floor(ms / HOUR)}h`
					: `${Math.floor(ms / DAY)}d`;
	if (!word) return "now";
	return d > 0 ? `in ${word}` : word;
}

/** A duration in the same units: "<1m", "12m", "1h 11m", "2d". */
export function spanWord(ms: number): string {
	const min = Math.floor(Math.max(0, ms) / MIN);
	if (min < 1) return "<1m";
	if (min < 60) return `${min}m`;
	const h = Math.floor(min / 60);
	if (h >= 24) return `${Math.floor(h / 24)}d`;
	return min % 60 ? `${h}h ${min % 60}m` : `${h}h`;
}
