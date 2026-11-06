// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HARNESS_IDS, HARNESS_REGISTRY } from "@prismalens/config/harness";
import {
	type CanonicalEvent,
	COLD_RESUME_TOKENS,
	type SessionCacheState,
	type ThreadSession,
} from "@prismalens/contracts";
import type { Wake } from "./wakes.service.js";

/** What PrismaLens tells the agent when it resumes after a limit (#1024). */
export const LIMIT_RESET_NOTE =
	"The usage limit has reset; continue where you left off.";
/** A limit wake fires this long after the reset the agent named. */
export const RESET_GRACE_MS = 2 * 60_000;
/** With no reset time, a limit wake retries this often, this many times. */
export const NO_TIME_RETRY_MS = 30 * 60_000;
export const NO_TIME_ATTEMPTS = 6;
/** An unknown cache is treated as cold after this long idle, for the resume prompt only. */
export const UNKNOWN_IDLE_MS = 60 * 60_000;
/** Idle compaction fires this long before the agent's cache expires. */
export const IDLE_COMPACT_LEAD_MS = 5 * 60_000;
/** Across threads, at most this many idle compactions an hour. */
export const IDLE_COMPACT_PER_HOUR = 3;

/** A registry lookup, injectable so tests can name an agent that qualifies for idle compaction. */
export interface AgentSessionFacts {
	label: string;
	cacheTtlMinutes: number | null;
	compactsWhenIdle: boolean;
	compactCommand: string | null;
}

export function registryFacts(
	harness: string | null,
): AgentSessionFacts | null {
	const id = HARNESS_IDS.find((h) => h === harness);
	if (!id) return null;
	const row = HARNESS_REGISTRY[id];
	return {
		label: row.label,
		cacheTtlMinutes: row.cacheTtlMinutes,
		compactsWhenIdle: row.compactsWhenIdle,
		compactCommand: row.compactCommand,
	};
}

/**
 * The agent's compact command: the registry's, or `compact` when the agent
 * advertised it (surface A's `agentCommands` feeds `advertised` once it lands).
 */
export function compactCommandOf(
	facts: AgentSessionFacts | null,
	advertised: readonly string[] = [],
): string | null {
	return (
		facts?.compactCommand ?? (advertised.includes("compact") ? "compact" : null)
	);
}

/** `cold` only where the registry knows the TTL and it has passed; never a guess (#1024). */
export function cacheState(
	facts: AgentSessionFacts | null,
	lastActivityAt: Date,
	now: Date,
): SessionCacheState {
	const ttl = facts?.cacheTtlMinutes;
	if (ttl == null) return "unknown";
	return now.getTime() - lastActivityAt.getTime() >= ttl * 60_000
		? "cold"
		: "warm";
}

/**
 * Whether a message to this thread should first offer the resume choices:
 * cold, or unknown and idle an hour, and carrying at least `threshold` tokens.
 */
export function needsResumePrompt(
	session: Pick<ThreadSession, "cache" | "contextTokens" | "lastActivityAt">,
	now: Date,
	threshold = COLD_RESUME_TOKENS,
): boolean {
	if ((session.contextTokens ?? 0) < threshold) return false;
	if (session.cache === "cold") return true;
	return (
		session.cache === "unknown" &&
		now.getTime() - Date.parse(session.lastActivityAt) >= UNKNOWN_IDLE_MS
	);
}

/** What a limit cut off, and the queued messages it carries. */
export interface InterruptedTurn {
	text: string;
	delivers: string[];
}

/**
 * What the limit cut off: messages queued but never delivered, in order, else
 * the last message the agent received. PrismaLens's restart notes are not the
 * user's. A message a resume carried counts as delivered by its `delivers`.
 */
export function interruptedTurn(
	events: readonly CanonicalEvent[],
): InterruptedTurn | null {
	const delivered = new Set<string>();
	let last: string | null = null;
	for (const e of events)
		if (e.kind === "operator_message" && e.delivered) {
			if (e.messageId) delivered.add(e.messageId);
			for (const id of e.delivers ?? []) delivered.add(id);
			if (!e.via?.restart && e.text.trim()) last = e.text;
		}
	const queued = events.filter(
		(e): e is Extract<CanonicalEvent, { kind: "message_queued" }> =>
			e.kind === "message_queued" && !delivered.has(e.messageId),
	);
	// A queued resume line already holds the messages it names; sending them beside it would repeat them.
	const carried = new Set(queued.flatMap((e) => e.delivers ?? []));
	const waiting = queued.filter((e) => !carried.has(e.messageId));
	if (waiting.length)
		return {
			text: waiting.map((e) => e.text).join("\n\n"),
			delivers: [
				...new Set(
					waiting.flatMap((e) => [e.messageId, ...(e.delivers ?? [])]),
				),
			],
		};
	return last ? { text: last, delivers: [] } : null;
}

/** The message a limit wake sends: the note, the interrupted turn and a draft the user chose, each whole. */
export function limitResumeText(
	turn: InterruptedTurn | null,
	draft: string | undefined,
): string {
	// A line an earlier resume queued already opens with the note.
	const noted = turn?.text.startsWith(LIMIT_RESET_NOTE) ?? false;
	return [noted ? null : LIMIT_RESET_NOTE, turn?.text, draft]
		.filter((p): p is string => !!p?.trim())
		.join("\n\n");
}

/** When a limit wake fires, and whether the retries are spent. */
export function limitWakeAt(
	resetsAt: Date | null,
	attempts: number,
	now: Date,
): Date | null {
	if (resetsAt) return new Date(resetsAt.getTime() + RESET_GRACE_MS);
	if (attempts > NO_TIME_ATTEMPTS) return null;
	return new Date(now.getTime() + NO_TIME_RETRY_MS);
}

export interface SessionRow {
	harness: string | null;
	usage: string | null;
	lastActivityAt: Date | null;
	updatedAt: Date;
	limitResetsAt: Date | null;
	autoResume: boolean | null;
	completedAt: Date | null;
}

/** The thread's session as the API returns it (#1024). */
export function threadSession(
	row: SessionRow,
	opts: {
		now: Date;
		facts: AgentSessionFacts | null;
		resumeAfterLimit: boolean;
		limitWake: Wake | null;
		compaction?: "agent_command" | "summary" | "none";
	},
): ThreadSession {
	const last = row.lastActivityAt ?? row.completedAt ?? row.updatedAt;
	const contextTokens = usedOf(row.usage);
	const command = compactCommandOf(opts.facts);
	const wake = opts.limitWake;
	const limited =
		!!wake &&
		(wake.state === "pending" ||
			(wake.state === "skipped" && wake.payload.gaveUp === true));
	const autoResume = row.autoResume ?? opts.resumeAfterLimit;
	const message =
		typeof wake?.payload.message === "string"
			? wake.payload.message
			: undefined;
	return {
		lastActivityAt: last.toISOString(),
		cache: cacheState(opts.facts, last, opts.now),
		...(contextTokens !== undefined ? { contextTokens } : {}),
		compaction: opts.compaction ?? "none",
		...(command ? { compactCommand: command } : {}),
		...(limited && wake
			? {
					limit: {
						resetsAt: row.limitResetsAt?.toISOString() ?? null,
						since: wake.createdAt.toISOString(),
						autoResume,
						...(autoResume && wake.state === "pending"
							? { nextAttemptAt: wake.at.toISOString() }
							: {}),
						attempts: wake.attempts,
						...(message ? { message } : {}),
						...(wake.payload.gaveUp === true ? { gaveUp: true } : {}),
					},
				}
			: {}),
	};
}

export function usedOf(raw: string | null | undefined): number | undefined {
	if (!raw) return undefined;
	try {
		const used = (JSON.parse(raw) as { used?: unknown }).used;
		return typeof used === "number" && used >= 0 ? used : undefined;
	} catch {
		return undefined;
	}
}
