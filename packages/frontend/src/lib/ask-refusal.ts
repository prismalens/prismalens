// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PendingAsk } from "@prismalens/contracts";

/** A run PrismaLens started (a schedule, an alert or a webhook): the API takes its answers from the host only. */
export function startedByPrismaLens(run: {
	scheduleId?: string | null;
	triggerType?: string | null;
}): boolean {
	return (
		!!run.scheduleId || (!!run.triggerType && run.triggerType !== "manual")
	);
}

export interface AskRefusal {
	/** Who can: "Only the computer running PrismaLens can approve this." */
	who: string;
	/** Why this device cannot. */
	why: string;
}

/**
 * Why this device may not answer an ask, and who can; null when it may. Mirrors the
 * API's refusals: a tool's ask and a run PrismaLens started take the host only.
 */
export function askRefusal(
	ask: Pick<PendingAsk, "kind" | "requiresHost">,
	onHost: boolean,
	hostOnlyRun = false,
): AskRefusal | null {
	if (onHost || !(ask.requiresHost || hostOnlyRun)) return null;
	const verb = ask.kind === "permission" ? "approve" : "answer";
	return {
		who: `Only the computer running PrismaLens can ${verb} this.`,
		why: ask.requiresHost
			? "A PrismaLens tool asked, and its answers stay on that computer."
			: "PrismaLens started this run, so its asks stay on that computer.",
	};
}
