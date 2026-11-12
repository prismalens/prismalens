// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { inboundText, inboundWords, retryWords } from "./inbound-rows";
import { deriveTranscript, type TranscriptItem } from "./investigation-events";

const base = (seq: number, ts: string) => ({
	runId: "11111111-1111-4111-8111-111111111111",
	branchId: "main",
	seq,
	ts,
});

const inbound = (
	seq: number,
	messageId: string,
	state: "waiting" | "delivered" | "failed",
	extra: Record<string, unknown> = {},
): CanonicalEvent =>
	({
		kind: "message_inbound",
		...base(seq, `2026-11-12T13:0${seq}:00.000Z`),
		messageId,
		source: "child",
		state,
		arrivedAt: "2026-11-12T13:00:00.000Z",
		from: { id: "c1", name: "DB Checker", link: "/threads/c1" },
		text: `Report ${messageId}`,
		line:
			state === "waiting"
				? "Waiting: Claude Code reached its session limit"
				: state === "failed"
					? "Not delivered: The thread has ended"
					: "Delivered",
		...extra,
	}) as CanonicalEvent;

const retry = (
	seq: number,
	messageId: string,
	attempt: number,
	phase: "waiting" | "succeeded",
): CanonicalEvent =>
	({
		kind: "provider_retry",
		...base(seq, `2026-11-12T13:0${seq}:00.000Z`),
		mode: "rate_limited",
		attempt,
		maxAttempts: 5,
		phase,
		at: "2026-11-12T15:45:00.000Z",
		messageId,
	}) as CanonicalEvent;

const inboundRows = (items: TranscriptItem[]) =>
	items.flatMap((i) => (i.kind === "inbound" ? [i.row] : []));

describe("incoming messages fold to one row each (#1101 cat 17 item 9)", () => {
	it("three child reports waiting during a limit, then delivered once each, stay three rows with the delivered state and first arrival", () => {
		const items = deriveTranscript([
			inbound(1, "m1", "waiting"),
			inbound(2, "m2", "waiting"),
			inbound(3, "m3", "waiting"),
			inbound(4, "m1", "delivered", { arrivedAt: "2026-11-12T14:00:00.000Z" }),
			inbound(5, "m2", "delivered"),
			inbound(6, "m3", "delivered"),
		]);
		const rows = inboundRows(items);
		expect(rows.map((r) => [r.messageId, r.state])).toEqual([
			["m1", "delivered"],
			["m2", "delivered"],
			["m3", "delivered"],
		]);
		expect(rows[0].arrivedAt).toBe("2026-11-12T13:00:00.000Z");
		expect(items.filter((i) => i.kind === "inbound")).toHaveLength(3);
	});

	it("words a waiting row by its reason and a failed row as one Failed line with its cause", () => {
		const [waiting, failed] = inboundRows(
			deriveTranscript([inbound(1, "w", "waiting"), inbound(2, "f", "failed")]),
		);
		expect(inboundWords(waiting)).toEqual({
			tone: "waiting",
			text: "Waiting: Claude Code reached its session limit",
		});
		expect(inboundWords(failed)).toEqual({
			tone: "failed",
			text: "Failed · The thread has ended",
		});
	});

	it("rebuilds a merged cron fire's line from mergedAt in the reader's locale, never the server's en-US line", () => {
		const [row] = inboundRows(
			deriveTranscript([
				inbound(1, "fire-1", "delivered", {
					source: "schedule",
					mergedInto: "fire-2",
					mergedAt: "2026-11-12T14:00:00.000Z",
					line: "Merged into the 2:00 PM run",
				}),
			]),
		);
		const de = inboundWords(row, "de-DE");
		const time = new Date("2026-11-12T14:00:00.000Z").toLocaleTimeString(
			"de-DE",
			{ hour: "numeric", minute: "2-digit" },
		);
		expect(de).toEqual({
			tone: "delivered",
			text: `Merged into the ${time} run`,
		});
		expect(de.text).not.toContain("PM");
	});

	it("sits a provider retry under its message, a succeeded phase replacing the same try's wait", () => {
		const items = deriveTranscript([
			inbound(1, "m1", "waiting"),
			retry(2, "m1", 2, "waiting"),
			retry(3, "m1", 2, "succeeded"),
			inbound(4, "m1", "delivered"),
		]);
		const [row] = inboundRows(items);
		expect(row.retries).toEqual([
			{
				attempt: 2,
				maxAttempts: 5,
				mode: "rate_limited",
				phase: "succeeded",
				at: "2026-11-12T15:45:00.000Z",
			},
		]);
		expect(retryWords(row.retries[0])).toBe("Went through on try 2");
		expect(items.map((i) => i.kind)).toEqual(["inbound"]);
	});

	it("reads a waiting retry with its try count and time", () => {
		expect(
			retryWords(
				{
					attempt: 2,
					maxAttempts: 5,
					mode: "overloaded",
					phase: "waiting",
					at: "2026-11-12T15:45:00.000Z",
				},
				"en-US",
			),
		).toBe(
			`Provider busy · try 2 of 5 at ${new Date("2026-11-12T15:45:00.000Z").toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/ /g, " ")}`,
		);
	});

	// a04d92755 quotes plain words: no thread path, line breaks folded to spaces.
	it("quotes a child's report without the thread path its header already links, on one line", () => {
		const [row] = inboundRows(
			deriveTranscript([
				inbound(1, "m1", "delivered", {
					text: "/threads/5d3191fd-dbcc-4adc-9503-2166d9a11f69 finished: answered.\nReport done.",
				}),
			]),
		);
		expect(inboundText(row)).toBe("finished: answered. Report done.");
	});

	it("drops a child's finish line when its report arrived as a message, keeping the finish of a child that sent none", () => {
		const finished = (seq: number, childId: string): CanonicalEvent =>
			({
				kind: "child_finished",
				...base(seq, `2026-11-12T13:0${seq}:00.000Z`),
				childId,
				link: `/threads/${childId}`,
				role: "db",
				outcome: "answered",
				excerpt: "Report done.",
			}) as CanonicalEvent;
		const items = deriveTranscript(
			[finished(1, "c1"), inbound(2, "m1", "delivered"), finished(3, "c2")],
			{ nodes: () => true },
		);
		expect(
			items.map((i) =>
				i.kind === "node" && i.event.kind === "child_finished"
					? `finish:${i.event.childId}`
					: i.kind,
			),
		).toEqual(["inbound", "finish:c2"]);
	});
});
