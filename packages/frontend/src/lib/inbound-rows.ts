// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type CanonicalEvent,
	inboundLine,
	shortTime,
} from "@prismalens/contracts";

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
	if (row.state === "waiting") return { tone: "waiting", text: row.line };
	const why = row.line.replace(/^Not delivered:?\s*/, "");
	return {
		tone: "failed",
		text: why && why !== row.line ? `Failed · ${why}` : "Failed",
	};
}

/** A retry under its message: "Rate limited · try 2 of 5 at 3:45 PM", then "Went through on try 2". */
export function retryWords(r: InboundRetry, locale?: string): string {
	if (r.phase === "succeeded") return `Went through on try ${r.attempt}`;
	const why = r.mode === "overloaded" ? "Provider busy" : "Rate limited";
	return `${why} · try ${r.attempt} of ${r.maxAttempts} at ${shortTime(new Date(r.at), locale)}`;
}
