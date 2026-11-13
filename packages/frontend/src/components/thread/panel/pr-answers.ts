// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadContext } from "@prismalens/contracts";
import type { PrAnswers } from "./PullRequests";

/** What a PR answers, from the thread's incident and report (#1101 category 15 item 6). */
export function prAnswersOf(
	context: ThreadContext | undefined,
): PrAnswers | null {
	return context?.kind === "incident"
		? { incidentNumber: context.incident.number, cause: causeOf(context) }
		: null;
}

/** The report's cause as the PR view names it; a supported one stays "likely" (guideline 8). */
function causeOf(
	c: Extract<ThreadContext, { kind: "incident" }>,
): string | null {
	const confirmed = c.suspects.find((s) => s.status === "confirmed");
	if (confirmed) return confirmed.statement;
	const supported = c.suspects.find((s) => s.status === "supported");
	return supported ? `likely ${supported.statement}` : null;
}
