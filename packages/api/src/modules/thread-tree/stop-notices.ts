// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	STOP_REASONS,
	THREAD_STOP_REASONS,
	type ThreadStopReason,
} from "@prismalens/contracts";
import { threadLink } from "./tree-text.js";

/** The stored message type of a notice from PrismaLens; it counts against no cap. */
export const NOTICE = "notice";

/** The idempotency key a stop notice is stored under: its reason and the run's end. */
export const noticeKey = (reason: ThreadStopReason, endedAt: Date) =>
	`stop:${reason}:${endedAt.toISOString()}`;

/** The reason a stored notice carries, from its key. */
export function noticeReason(requestId: string): ThreadStopReason | null {
	const reason = requestId.split(":")[1];
	return (THREAD_STOP_REASONS as readonly string[]).includes(reason ?? "")
		? (reason as ThreadStopReason)
		: null;
}

/** Whether a stored notice may wake an idle starter (`STOP_REASONS[reason].wakes`). */
export function noticeWakes(requestId: string): boolean {
	const reason = noticeReason(requestId);
	return !!reason && STOP_REASONS[reason].wakes;
}

/** One line: which thread stopped and how. Never its results. */
export function noticeLine(
	r: {
		id: string;
		title: string | null;
		incidentId: string | null;
		scheduleId: string | null;
	},
	reason: ThreadStopReason,
): string {
	return `${r.title?.trim() || "A thread you started"} (${threadLink(r)}) stopped: ${STOP_REASONS[reason].how}.`;
}

/** Several stops for one starter, as the one notice its agent reads. */
export function noticeText(lines: readonly string[]): string {
	return lines.length === 1
		? `[PrismaLens] ${lines[0]}`
		: `[PrismaLens] ${lines.length} threads you started stopped:\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
