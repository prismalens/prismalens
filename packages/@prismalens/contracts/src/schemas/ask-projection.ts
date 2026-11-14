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
		source: e.source ?? { kind: "agent" },
		title: e.title,
		detail: e.detail,
		openedAt: e.ts,
		expiresAt: e.expiresAt,
		permission: {
			toolKind: e.toolKind,
			...(e.detail ? { command: e.detail } : {}),
			...(e.input ? { input: e.input } : {}),
			options: e.options ?? [],
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

type Queued = Extract<CanonicalEvent, { kind: "message_queued" }>;

/** Messages still queued when the last process died, as they last stood: edits folded in, withdrawals gone (#1024). */
export function queuedLeftWaiting(events: readonly CanonicalEvent[]): Queued[] {
	const open = new Map<string, Queued>();
	for (const e of events) {
		if (e.kind === "message_queued") open.set(e.messageId, e);
		else if (e.kind === "message_edited") {
			const q = open.get(e.messageId);
			if (q) open.set(e.messageId, { ...q, text: e.text });
		} else if (
			e.kind === "message_withdrawn" ||
			(e.kind === "operator_message" && e.messageId)
		)
			open.delete(e.messageId as string);
	}
	return [...open.values()];
}

/**
 * Engine asks the last process left waiting, which no run can answer now (#1024).
 * A PrismaLens tool's ask is held in `tool_asks`, outlives a restart, and is left alone.
 */
export function asksLeftOpen(events: readonly CanonicalEvent[]): {
	legacy: { askId: string; branchId: string }[];
	asks: { askId: string; branchId: string }[];
} {
	const legacy = new Map<string, string>();
	const asks = new Map<string, string>();
	for (const e of events) {
		if (e.kind === "permission_ask") legacy.set(e.askId, e.branchId);
		else if (e.kind === "permission_answer") legacy.delete(e.askId);
		else if (e.kind === "ask_opened" && e.ask.source.kind !== "tool")
			asks.set(e.ask.askId, e.branchId);
		else if (e.kind === "ask_closed") asks.delete(e.askId);
	}
	const list = (m: Map<string, string>) =>
		[...m].map(([askId, branchId]) => ({ askId, branchId }));
	return { legacy: list(legacy), asks: list(asks) };
}
