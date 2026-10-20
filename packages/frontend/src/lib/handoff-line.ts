// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ACCESS_LEVEL_LABEL,
	type HandoffPreview,
	type RunEndReason,
} from "@prismalens/contracts";

/** The line over a finished run's box: where the follow-up goes, what it carries, and what blocks it. */
export function handoffLine(
	p: HandoffPreview,
	agent: string,
): { text: string; problem: string | null } {
	const level = p.accessLevel
		? ` Permission: ${ACCESS_LEVEL_LABEL[p.accessLevel]} (inherited).`
		: "";
	const where =
		p.route === "load"
			? `Continues in ${agent}'s own session.`
			: `Continues in a fresh ${agent} session. Carries: ${p.carried}${
					p.omitted ? `; omits ${p.omitted}` : ""
				}.${level}`;
	return {
		text: p.note ? `${where} ${p.note}` : where,
		problem: p.preflight ? `${p.preflight.problem} ${p.preflight.fix}` : null,
	};
}

/** A failed run's status when a restart or a usage limit ended it, in place of "Failed". */
export function endReasonStatus(
	endReason: RunEndReason | null | undefined,
	agent: string,
): { text: string; sub: string } | null {
	if (endReason === "interrupted")
		return {
			text: "Interrupted (PrismaLens restarted)",
			sub: "Its last command may or may not have completed. Continue below, in this agent or another.",
		};
	if (endReason === "limited")
		return {
			text: "Limited",
			sub: `${agent} reached its usage limit. Continue below in another agent, or wait for the limit to reset.`,
		};
	return null;
}
