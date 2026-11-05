// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Every ask a run's events hold, new (`ask_opened` / `ask_closed`) and legacy
 * (`permission_ask` / `permission_answer`), in one shape (#1024).
 */
import type { AskAnswer, AskClosedOutcome, PendingAsk } from "./asks.js";
import type { CanonicalEvent } from "./investigation.js";

export interface ProjectedAsk {
	ask: PendingAsk;
	/** Null while it waits. */
	closed: {
		outcome: AskClosedOutcome;
		answer?: AskAnswer;
		at: string;
	} | null;
	/** The `seq` of the event that opened it, so a chip can scroll to it. */
	seq: number;
}

function legacyAsk(
	threadId: string,
	e: Extract<CanonicalEvent, { kind: "permission_ask" }>,
): PendingAsk {
	return {
		askId: e.askId,
		threadId,
		kind: "permission",
		requiresHost: false,
		source: { kind: "agent" },
		title: e.title,
		detail: e.detail,
		openedAt: e.ts,
		expiresAt: e.expiresAt,
		permission: {
			toolKind: e.toolKind,
			...(e.detail ? { command: e.detail } : {}),
			...(e.input ? { input: e.input } : {}),
			options: [],
			...(e.toolCallId ? { toolCallId: e.toolCallId } : {}),
			...(e.server ? { server: e.server } : {}),
			...(e.identity ? { identity: e.identity } : {}),
		},
	};
}

/** Every ask the events opened, oldest first, each with how it closed. */
export function projectAsks(
	threadId: string,
	events: readonly CanonicalEvent[],
): ProjectedAsk[] {
	const asks = new Map<string, ProjectedAsk>();
	for (const e of events) {
		if (e.kind === "ask_opened")
			asks.set(e.ask.askId, { ask: e.ask, closed: null, seq: e.seq });
		else if (e.kind === "permission_ask")
			asks.set(e.askId, {
				ask: legacyAsk(threadId, e),
				closed: null,
				seq: e.seq,
			});
		else if (e.kind === "ask_closed" || e.kind === "permission_answer") {
			const found = asks.get(e.askId);
			if (found && !found.closed)
				found.closed = {
					outcome: e.outcome,
					...(e.kind === "ask_closed" && e.answer ? { answer: e.answer } : {}),
					at: e.ts,
				};
		}
	}
	return [...asks.values()];
}

/** The asks still waiting, oldest first. */
export function pendingAsks(
	threadId: string,
	events: readonly CanonicalEvent[],
): PendingAsk[] {
	return projectAsks(threadId, events)
		.filter((a) => !a.closed)
		.map((a) => a.ask);
}
