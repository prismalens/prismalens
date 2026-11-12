// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ASK_REFUSAL,
	type AskRefusalReason,
	type PendingAsk,
} from "@prismalens/contracts";

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
	reason: AskRefusalReason;
	/** Who can answer, then why this device cannot: the API's own refusal sentence. */
	text: string;
}

/**
 * Why this device may not answer an ask, and who can; null when it may. Mirrors the
 * API's refusals: a secret, a tool's ask and a run PrismaLens started take the host only.
 */
export function askRefusal(
	ask: Pick<PendingAsk, "kind" | "requiresHost">,
	onHost: boolean,
	hostOnlyRun = false,
): AskRefusal | null {
	if (onHost || !(ask.requiresHost || hostOnlyRun || ask.kind === "secret"))
		return null;
	const reason: AskRefusalReason =
		ask.kind === "secret"
			? "secret"
			: ask.requiresHost
				? "toolAsk"
				: "startedByPrismaLens";
	return { reason, text: ASK_REFUSAL[reason] };
}
