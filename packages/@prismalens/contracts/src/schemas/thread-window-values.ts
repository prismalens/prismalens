// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).
import type { CanonicalEvent } from "./investigation.js";
import { INVESTIGATION_REPORT_BRANCH } from "./investigation-values.js";
import type { FailureMode } from "./provider-failure.js";
import { failureLine } from "./provider-failure-values.js";
import type { IndexAuthor, IndexEntry, RailMark } from "./thread-window.js";

// ---- identity and position ----

/** An event's identity: `branch:seq`, or `report:seq` for the terminal report. */
export function eventKey(e: CanonicalEvent): string {
	return e.kind === "report" ? `report:${e.seq}` : `${e.branchId}:${e.seq}`;
}

/** A key's `(seq, branchId)`; the branch is everything before the last colon. */
export function parseEventKey(
	key: string,
): { branchId: string; seq: number } | null {
	const at = key.lastIndexOf(":");
	if (at <= 0) return null;
	const seq = Number(key.slice(at + 1));
	if (!Number.isInteger(seq)) return null;
	const branch = key.slice(0, at);
	return {
		branchId: branch === "report" ? INVESTIGATION_REPORT_BRANCH : branch,
		seq,
	};
}

/** Display order: `(seq, branchId)`, the order the record has always been read in. */
export function comparePosition(
	a: { seq: number; branchId: string },
	b: { seq: number; branchId: string },
): number {
	if (a.seq !== b.seq) return a.seq - b.seq;
	return a.branchId < b.branchId ? -1 : a.branchId > b.branchId ? 1 : 0;
}

export function compareKeys(a: string, b: string): number {
	const pa = parseEventKey(a);
	const pb = parseEventKey(b);
	if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
	return comparePosition(pa, pb);
}

/** Characters of a message's start the index keeps for the rail's preview. */
export const INDEX_PREVIEW_CHARS = 80;

const AUTH_FAILURE =
	/\b(api[ _-]?key|unauthori[sz]ed|authentication|invalid (?:x-)?api|401|revoked|credentials?)\b/i;

/** The error a Stop records: the turn ended as asked, so it is no break on the rail (#1101 cat 2). */
const STOP_ERROR = /^investigation cancelled/i;

export function preview(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > INDEX_PREVIEW_CHARS
		? `${flat.slice(0, INDEX_PREVIEW_CHARS - 1)}…`
		: flat;
}

/** The rail entry an event makes, or null: messages get a tick, breaks and products a mark. */
export function indexEntryOf(e: CanonicalEvent): IndexEntry | null {
	const key = eventKey(e);
	switch (e.kind) {
		case "operator_message":
			if (e.via?.restart)
				return [
					key,
					"system",
					"restart",
					"Interrupted by restart",
					e.ts,
					e.via.restart.stoppedAt,
				];
			return [key, "you", null, preview(e.text), e.ts, null];
		case "agent_step": {
			if (e.path.length > 0 || !e.text.trim()) return null;
			return [key, "agent", null, preview(e.text), e.ts, null];
		}
		case "thread_message":
			return e.direction === "received"
				? [key, "thread", null, preview(e.text), e.ts, null]
				: null;
		case "compaction":
			return e.phase === "started"
				? null
				: [
						key,
						"system",
						"compaction",
						e.phase === "failed" ? "Compaction failed" : "Context compacted",
						e.ts,
						null,
					];
		// A stop's line is built from its classification, never the stored text, which
		// on older or seeded records is the agent's raw words ("(401)", parser codes).
		case "usage_limit": {
			const mode = e.mode ?? "usage_limit";
			const mark = stopMark(mode);
			return [
				key,
				"system",
				mark,
				failureLine({ mode, window: e.window }, e.agent),
				e.ts,
				mark === "usage_limit" ? (e.resetsAt ?? null) : (e.mode ?? null),
			];
		}
		case "provider_blocked":
			return [
				key,
				"system",
				stopMark(e.mode),
				failureLine({ mode: e.mode }, e.agent),
				e.ts,
				e.mode,
			];
		case "run_interrupted":
			return [key, "system", "restart", "Interrupted by restart", e.ts, null];
		case "error": {
			if (STOP_ERROR.test(e.message)) return null;
			// A classified stop names itself; an unclassified one only says it was an error.
			const mode =
				e.failure?.mode ??
				(AUTH_FAILURE.test(e.message) ? ("key_rejected" as const) : undefined);
			return [
				key,
				"system",
				mode ? stopMark(mode) : "error",
				mode ? failureLine({ mode, window: e.failure?.window }) : "Error",
				e.ts,
				mode && mode !== "usage_limit" ? mode : null,
			];
		}
		case "resumed":
			return null;
		case "report":
			return [key, "agent", "report", "Report", e.ts, null];
		case "pull_request_linked":
			return [key, "system", "pr", preview(e.url), e.ts, null];
		default:
			return null;
	}
}

/** The rail mark a provider stop draws (#1101 categories 14 and 17). */
export function stopMark(mode: FailureMode): RailMark {
	switch (mode) {
		case "usage_limit":
			return "usage_limit";
		case "rate_limited":
		case "overloaded":
			return "rate_limit";
		case "key_rejected":
			return "auth";
		case "out_of_credit":
		case "spend_cap":
			return "blocked";
	}
}

/** Who opens a turn, when the event does; null when it does not start one. */
export function turnAuthorOf(e: CanonicalEvent): IndexAuthor | null {
	if (e.kind === "operator_message") return e.via?.restart ? "system" : "you";
	if (e.kind === "thread_message" && e.direction === "received")
		return "thread";
	return null;
}

/**
 * The earlier event an event belongs beside, by kind and id: a late tool result
 * joins its call, an answer its ask, a queue edit its message (#1101 cat 12).
 */
export function anchorRefOf(
	e: CanonicalEvent,
): { kind: "call" | "ask" | "queued"; id: string } | null {
	switch (e.kind) {
		case "tool_result":
			return { kind: "call", id: e.result.toolCallId };
		case "permission_answer":
		case "ask_closed":
			return { kind: "ask", id: e.askId };
		case "message_edited":
		case "message_withdrawn":
			return { kind: "queued", id: e.messageId };
		default:
			return null;
	}
}

/** The ids an event opens that later events anchor to. */
export function anchorIdsOf(
	e: CanonicalEvent,
): { kind: "call" | "ask" | "queued"; id: string }[] {
	switch (e.kind) {
		case "agent_step":
			return e.toolCalls.map((c) => ({
				kind: "call" as const,
				id: c.toolCallId,
			}));
		case "harness_tool_call":
			return e.callId ? [{ kind: "call", id: e.callId }] : [];
		case "permission_ask":
			return [{ kind: "ask", id: e.askId }];
		case "ask_opened":
			return [{ kind: "ask", id: e.ask.askId }];
		case "message_queued":
			return [{ kind: "queued", id: e.messageId }];
		default:
			return [];
	}
}

/**
 * Fold for a case-blind match, per code point, keeping where each folded unit
 * came from: `İ` lowercases to two units, and offsets must land in the original.
 */
export function foldWithMap(text: string): { folded: string; from: number[] } {
	let folded = "";
	const from: number[] = [];
	let i = 0;
	for (const ch of text) {
		const low = ch.toLowerCase();
		folded += low;
		for (let u = 0; u < low.length; u++) from.push(i);
		i += ch.length;
	}
	from.push(text.length);
	return { folded, from };
}

/** Each occurrence of `q` in `text` as `[start, end)` in the original text; never overlapping. */
export function findOccurrences(
	text: string,
	q: string,
	opts: { caseSensitive?: boolean } = {},
): [number, number][] {
	if (!q) return [];
	const out: [number, number][] = [];
	if (opts.caseSensitive) {
		for (
			let at = text.indexOf(q);
			at !== -1;
			at = text.indexOf(q, at + q.length)
		)
			out.push([at, at + q.length]);
		return out;
	}
	// Per code point on both sides: a whole-string fold is context-dependent (final sigma).
	const needle = foldWithMap(q).folded;
	const { folded, from } = foldWithMap(text);
	for (
		let at = folded.indexOf(needle);
		at !== -1;
		at = folded.indexOf(needle, at + needle.length)
	) {
		const start = from[at] as number;
		const last = from[at + needle.length - 1] as number;
		// The end is past the original code point the match's last unit came from.
		const end = last + ((text.codePointAt(last) as number) > 0xffff ? 2 : 1);
		if (out.length && (out[out.length - 1] as [number, number])[1] > start)
			continue;
		out.push([start, end]);
	}
	return out;
}
