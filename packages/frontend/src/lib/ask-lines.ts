// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The words around an ask (#1101 category 8 items 2 and 6): the exact thing to
 * approve, why it asked, and what Always remembers. Agent text stays plain.
 */
import type { AccessLevel } from "@prismalens/config/harness";
import { ACCESS_LEVEL_LABEL, type PendingAsk } from "@prismalens/contracts";
import { relTime } from "@/components/kit/rel-time";

/** The exact command, path or input an approval is for; null when the ask names none. */
export function askSubject(ask: PendingAsk): string | null {
	const p = ask.permission;
	return p?.command?.trim() || ask.detail?.trim() || p?.input?.trim() || null;
}

/** One line: why this asked, from the thread's mode. */
export function whyAsked(
	ask: PendingAsk,
	level: AccessLevel | null | undefined,
): string {
	if (ask.source.kind === "tool")
		return "PrismaLens tools always ask the host first.";
	if (ask.kind !== "permission")
		return "The agent asked you directly; no mode skips a question.";
	if (ask.permission?.variant === "plan")
		return "The agent finished planning and waits for your go.";
	const mode = level ? ACCESS_LEVEL_LABEL[level] : null;
	return mode
		? `Asked because this thread runs in ${mode}.`
		: "Asked because the agent's own mode asks first.";
}

/** What Always would remember; null when this ask offers no Always. */
export function alwaysLine(ask: PendingAsk): string | null {
	const p = ask.permission;
	if (!p?.identity || p.variant === "plan") return null;
	return p.pattern
		? `Always allows ${p.pattern} in this thread from now on.`
		: "Always allows this exact action in this thread from now on.";
}

/** How long an ask has waited, in the kit's one relative format: "now", "3m". */
export function waitedFor(openedAt: string, now: number): string {
	return relTime(openedAt, now);
}
