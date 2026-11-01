// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import type { useToast } from "@/hooks/use-toast";
import { formatDayClock } from "./format-time";
import { getErrorMessage } from "./get-error-message";

type OperatorEvent = Extract<CanonicalEvent, { kind: "operator_message" }>;
export type RestartVia = NonNullable<
	NonNullable<OperatorEvent["via"]>["restart"]
>;

/** A run PrismaLens did not resume carries its reason after this prefix (#981). */
export const NOT_RESUMED = "Not resumed: ";

/** The reason a restarted run was not resumed, or null for any other error. */
export function notResumedReason(
	error: string | null | undefined,
): string | null {
	return error?.startsWith(NOT_RESUMED)
		? error.slice(NOT_RESUMED.length)
		: null;
}

/** The divider before PrismaLens's own message: `Stopped at 08:52, resumed at 09:14`. */
export function restartDivider(r: RestartVia, now: number): string {
	return `Stopped at ${formatDayClock(r.stoppedAt, now)}, resumed at ${formatDayClock(r.resumedAt, now)}`;
}

/** What follows `PrismaLens` on the message: `, sent automatically at 09:14`. */
export function restartSent(r: RestartVia, now: number): string {
	return r.by === "operator"
		? ", sent when you pressed Resume"
		: `, sent automatically at ${formatDayClock(r.resumedAt, now)}`;
}

/** The restart the run's newest operator message carries, or null (#981). */
export function latestRestart(
	events: readonly CanonicalEvent[],
): RestartVia | null {
	const last = events.findLast((e) => e.kind === "operator_message");
	return last?.kind === "operator_message" ? (last.via?.restart ?? null) : null;
}

/** The strip's detail while a resumed run works. */
export function resumedDetail(r: RestartVia): string {
	return r.by === "operator"
		? "Resumed by you"
		: "Resumed after PrismaLens restarted";
}

/** A refused Resume (409: the run was not interrupted, or is live) says why in the app's error toast (#981). */
export const resumeFailed =
	(toast: ReturnType<typeof useToast>["toast"]) => (error: unknown) =>
		toast({
			title: "Run not resumed",
			description: getErrorMessage(error),
			variant: "destructive",
		});
