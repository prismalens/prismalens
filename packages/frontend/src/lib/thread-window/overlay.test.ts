// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	CanonicalEvent,
	PendingAsk,
	RecordedHypothesis,
	ThreadState,
} from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	overlayAsks,
	overlayHypotheses,
	queueEvents,
} from "./overlay";

const RUN_ID = "00000000-0000-0000-0000-000000000001";

function askOpened(askId: string, title: string): CanonicalEvent {
	return {
		kind: "ask_opened",
		runId: RUN_ID,
		branchId: "main",
		path: [],
		seq: 1,
		ask: {
			askId,
			threadId: RUN_ID,
			kind: "question",
			requiresHost: false,
			source: { kind: "agent" },
			title,
			openedAt: "2026-11-12T00:00:00Z",
			questions: [
				{
					id: "q1",
					prompt: title,
					multiSelect: false,
					allowOther: false,
					options: [{ id: "opt1", label: "Option 1" }],
				},
			],
		},
		ts: "2026-11-12T00:00:00Z",
	};
}

function askClosed(askId: string): CanonicalEvent {
	return {
		kind: "ask_closed",
		runId: RUN_ID,
		branchId: "main",
		path: [],
		seq: 2,
		askId,
		outcome: "answered",
		ts: "2026-11-12T00:01:00Z",
	};
}

function findingRecorded(id: string, statement: string): CanonicalEvent {
	return {
		kind: "finding_recorded",
		runId: RUN_ID,
		branchId: "main",
		path: [],
		seq: 3,
		finding: {
			type: "hypothesis",
			id,
			statement,
			evidenceIds: [],
			status: "confirmed",
			at: "2026-11-12T00:02:00Z",
		},
		ts: "2026-11-12T00:02:00Z",
	};
}

describe("overlay", () => {
	it("overlayAsks drops a base ask whose ask_closed is in the delta, and adds one opened by an ask_opened in the delta.", () => {
		const baseAsk1: PendingAsk = {
			askId: "ask-1",
			threadId: RUN_ID,
			kind: "question",
			requiresHost: false,
			source: { kind: "agent" },
			title: "Confirm deployment?",
			openedAt: "2026-11-12T00:00:00Z",
			questions: [],
		};
		const baseAsk2: PendingAsk = {
			askId: "ask-2",
			threadId: RUN_ID,
			kind: "input",
			requiresHost: false,
			source: { kind: "agent" },
			title: "Enter token",
			openedAt: "2026-11-12T00:00:00Z",
		};
		const delta: CanonicalEvent[] = [
			askClosed("ask-1"),
			askOpened("ask-3", "Confirm restart?"),
		];

		const result = overlayAsks(RUN_ID, [baseAsk1, baseAsk2], delta);

		expect(result.map((a) => a.askId)).toEqual(["ask-2", "ask-3"]);
		expect(result.find((a) => a.askId === "ask-3")?.title).toBe(
			"Confirm restart?",
		);
	});

	it("queueEvents maps {messageId, text, at} to message_queued events with that messageId, text and ts.", () => {
		const queue: ThreadState["queue"] = [
			{
				messageId: "msg-1",
				text: "queued text 1",
				at: "2026-11-12T01:00:00Z",
			},
			{
				messageId: "msg-2",
				text: "queued text 2",
				at: "2026-11-12T01:05:00Z",
			},
		];

		const events = queueEvents(RUN_ID, queue);

		expect(events).toEqual([
			{
				kind: "message_queued",
				runId: RUN_ID,
				branchId: "queue",
				path: [],
				seq: -1,
				ts: "2026-11-12T01:00:00Z",
				messageId: "msg-1",
				text: "queued text 1",
			},
			{
				kind: "message_queued",
				runId: RUN_ID,
				branchId: "queue",
				path: [],
				seq: -1,
				ts: "2026-11-12T01:05:00Z",
				messageId: "msg-2",
				text: "queued text 2",
			},
		]);
	});

	it("overlayHypotheses: a delta finding_recorded for an existing hypothesis id replaces its statement.", () => {
		const baseHypothesis: RecordedHypothesis = {
			id: "hyp-1",
			statement: "Initial statement",
			evidenceIds: [],
			status: "confirmed",
			at: "2026-11-12T00:00:00Z",
		};
		const delta: CanonicalEvent[] = [
			findingRecorded("hyp-1", "Updated statement from delta"),
		];

		const result = overlayHypotheses([baseHypothesis], delta);

		expect(result.length).toBe(1);
		expect(result[0]?.id).toBe("hyp-1");
		expect(result[0]?.statement).toBe("Updated statement from delta");
	});
});
