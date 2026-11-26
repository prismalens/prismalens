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
	// The run's own reason when it kept one (#1193): the thread's mode alone can't explain a card in Full access.
	switch (ask.permission?.why) {
		case "not_an_edit":
			return `Asked because ${mode ?? "this thread's mode"} runs only file edits by itself.`;
		case "wait_for_me":
			return "Asked because Wait for me is on: every action waits for you.";
		case "unattended":
			return "Asked because this run had nobody watching, so it waits for you.";
		case "no_allow_option":
			return "Asked because the agent offered no way to allow it by itself.";
	}
	return mode
		? `Asked because this thread runs in ${mode}.`
		: "Asked because the agent's own mode asks first.";
}

/**
 * What Always would remember; null when this ask offers no Always. An agent's ask takes
 * it only when the agent offered `allow_always` (ACP); PrismaLens's own tools remember by identity.
 */
export function alwaysLine(ask: PendingAsk): string | null {
	const p = ask.permission;
	if (!p || p.variant === "plan") return null;
	if (ask.source.kind !== "tool")
		return p.options.some((o) => o.kind === "allow_always")
			? "Always stops the agent asking for this in this thread."
			: null;
	if (!p.identity) return null;
	return p.pattern
		? `Always allows ${p.pattern} in this thread from now on.`
		: "Always allows this exact action in this thread from now on.";
}

/** False when the agent offers only a standing allow, so a once-only approval cannot be sent (#1180). */
export function onceOffered(ask: PendingAsk): boolean {
	const p = ask.permission;
	if (!p || ask.source.kind === "tool" || p.options.length === 0) return true;
	return p.options.some((o) => o.kind === "allow_once");
}

/** How long an ask has waited, in the kit's one relative format: "now", "3m". */
export function waitedFor(openedAt: string, now: number): string {
	return relTime(openedAt, now, { past: true });
}
