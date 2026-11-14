// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CanonicalEvent,
	inboundLine,
	isBlockedMode,
	shortTime,
} from "@prismalens/contracts";
import { stopCause } from "@/lib/stop-causes";

type Inbound = Extract<CanonicalEvent, { kind: "message_inbound" }>;
type Retry = Extract<CanonicalEvent, { kind: "provider_retry" }>;

export interface InboundRetry {
	attempt: number;
	maxAttempts: number;
	mode: Retry["mode"];
	phase: "waiting" | "succeeded";
	at: string;
}

/** One incoming message as one transcript row, whatever states it passed through (#1101 cat 17 item 9). */
export interface InboundRow {
	messageId: string;
	source: Inbound["source"];
	state: Inbound["state"];
	arrivedAt: string;
	from?: Inbound["from"];
	text: string;
	line: string;
	/** The provider stop it waits out or failed on. */
	failure?: Inbound["failure"];
	mergedAt?: string;
	retries: InboundRetry[];
}

/** The row after one more `message_inbound` event: its latest state wins, its arrival stays. */
export function foldInbound(
	row: InboundRow | undefined,
	e: Inbound,
): InboundRow {
	return {
		messageId: e.messageId,
		source: e.source,
		state: e.state,
		arrivedAt: row?.arrivedAt ?? e.arrivedAt,
		from: e.from ?? row?.from,
		text: e.text || row?.text || "",
		line: e.line,
		failure: e.failure ?? (e.state === "delivered" ? undefined : row?.failure),
		mergedAt: e.mergedInto ? e.mergedAt : undefined,
		retries: row?.retries ?? [],
	};
}

/** A provider retry of this message's call; a later phase of the same try replaces it. */
export function addRetry(row: InboundRow, e: Retry): InboundRow {
	const next: InboundRetry = {
		attempt: e.attempt,
		maxAttempts: e.maxAttempts,
		mode: e.mode,
		phase: e.phase ?? "waiting",
		at: e.at,
	};
	return {
		...row,
		retries: [...row.retries.filter((r) => r.attempt !== e.attempt), next],
	};
}

export type InboundTone = "waiting" | "delivered" | "failed";

/**
 * The row's words in the reader's locale. A fire a later one replaced is rebuilt
 * from `mergedAt`, never the server's en-US line.
 */
export function inboundWords(
	row: InboundRow,
	locale?: string,
): { tone: InboundTone; text: string } {
	if (row.state === "delivered")
		return {
			tone: "delivered",
			text: row.mergedAt
				? inboundLine("delivered", {
						merged: { at: new Date(row.mergedAt), locale },
					})
				: "Delivered",
		};
	// The stop's own line names it once; each waiting row only says it waits (sheet §10).
	if (row.state === "waiting")
		return {
			tone: "waiting",
			text:
				row.failure && !isBlockedMode(row.failure.mode)
					? "Waiting for the limit"
					: row.line,
		};
	const why = row.line.replace(/^Not delivered:?\s*/, "");
	return {
		tone: "failed",
		text: why && why !== row.line ? `Failed · ${why}` : "Failed",
	};
}

/** A retry under its message: "Rate limited · try 2 of 5 at 3:45 PM", then "Went through on try 2". */
export function retryWords(r: InboundRetry, locale?: string): string {
	if (r.phase === "succeeded") return `Went through on try ${r.attempt}`;
	const why = stopCause(r.mode).name;
	return `${why} · try ${r.attempt} of ${r.maxAttempts} at ${shortTime(new Date(r.at), locale)}`;
}

/**
 * The quoted text as plain words: no agent envelope (`[FROM db #2] result:`), no
 * thread path, no machine path, no Markdown marks.
 */
export function plainExcerpt(text: string): string {
	return text
		.replace(/\[FROM [^\]]*\]\s*(?:[a-z_]+:\s*)?/gi, "")
		.replace(/(?:https?:\/\/[^\s/]+)?\/threads\/[\w-]+\S*\s*/g, "")
		.replace(
			/(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|private)\/)(?:[^\s\\/]+[\\/])+([^\s\\/]+)/g,
			"$1",
		)
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, "")
		.replace(/(\*\*|__|`+|~~)/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** The quoted text, without the sender's thread path the row's header already links. */
export function inboundText(row: Pick<InboundRow, "text">): string {
	return plainExcerpt(deliveredWords(row.text).text);
}

/** What PrismaLens wraps a delivery in for the agent, matched so a reader sees only the words. */
const THREAD_ENVELOPE = /^\[Message from (.+?)(?: \((\/[^)\s]+)\))?\]\s*/;
const WAKE_ENVELOPE = /^The wake you scheduled(?: \(pl_[a-z_]+\))? is due:\s*/;

/**
 * A delivered message as a reader says it: who sent it and its words, without the
 * envelope the agent received (`[Message from X (/threads/…)]`, the wake's tool name).
 */
export function deliveredWords(text: string): {
	from: "thread" | "wake" | null;
	name?: string;
	link?: string;
	text: string;
} {
	const thread = THREAD_ENVELOPE.exec(text);
	if (thread)
		return {
			from: "thread",
			name: thread[1],
			link: thread[2],
			text: text.slice(thread[0].length),
		};
	const wake = WAKE_ENVELOPE.exec(text);
	if (wake) return { from: "wake", text: text.slice(wake[0].length) };
	return { from: null, text };
}
