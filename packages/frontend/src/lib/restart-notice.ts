// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RestartSummary } from "@prismalens/contracts";
import { formatDayClock } from "./format-time";
import { notResumedReason } from "./restart";

/** The device's record of the last start it showed (#981); the value is the summary's `at`. */
export const SEEN_KEY = "pl.restartNotice.seen";
const HOUR = 3_600_000;

type Summary = NonNullable<RestartSummary>;

/** Whether this device shows the notice: recent, something happened, and not shown here before. */
export function shouldShowRestartNotice(
	summary: RestartSummary | undefined,
	seenAt: string | null,
	now: number,
): summary is Summary {
	if (!summary) return false;
	if (summary.resumed.length + summary.skipped.length === 0) return false;
	if (seenAt === summary.at) return false;
	const age = now - new Date(summary.at).getTime();
	return age >= 0 && age <= HOUR;
}

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

/** `22 minutes`, `3 hours`, `2 days`: how long PrismaLens was off. */
export function offFor(ms: number): string {
	const minutes = Math.max(1, Math.round(ms / 60_000));
	if (minutes < 60) return plural(minutes, "minute", "minutes");
	const hours = Math.round(minutes / 60);
	if (hours < 48) return plural(hours, "hour", "hours");
	return plural(Math.round(hours / 24), "day", "days");
}

export interface RestartNoticeView {
	title: string;
	/** Only when PrismaLens knows when it stopped. */
	gap: string | null;
	resumed: string | null;
	skipped: string | null;
	/** The first run that could not resume, for the action. */
	open: { investigationId: string; incidentId: string; label: string } | null;
}

export function restartNoticeView(
	summary: Summary,
	now: number,
): RestartNoticeView {
	const first = summary.skipped[0];
	const name = first
		? first.incidentNumber === null
			? first.title
			: `INC-${first.incidentNumber}`
		: null;
	return {
		title: "PrismaLens started again",
		gap: summary.stoppedAt
			? `It stopped at ${formatDayClock(summary.stoppedAt, now)} and was off for ${offFor(
					new Date(summary.at).getTime() -
						new Date(summary.stoppedAt).getTime(),
				)}.`
			: null,
		resumed: summary.resumed.length
			? `${plural(summary.resumed.length, "investigation", "investigations")} resumed`
			: null,
		skipped:
			first && name
				? `${summary.skipped.length} couldn't: ${name}, ${notResumedReason(first.reason) ?? first.reason}`
				: null,
		open:
			first && name
				? {
						investigationId: first.investigationId,
						incidentId: first.incidentId,
						label: `Open ${name}`,
					}
				: null,
	};
}
