// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import type { CanonicalEvent } from "@prismalens/contracts";
import {
	buildProjection,
	lightEntry,
	openerIds,
} from "./projection.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

function makeRow(seq: number, branchId = "main", ordinal = seq, bytes = 100) {
	return { seq, branchId, ordinal, bytes };
}

describe("thread-window projection", () => {
	it("A tool_result stored two turns after its call has anchorAt equal to the call's index, and is listed in dependents of that index", () => {
		const callEvent: CanonicalEvent = {
			kind: "agent_step",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 1,
			ts: "2026-07-05T00:01:00Z",
			text: "calling tool",
			toolCalls: [{ toolCallId: "call-1", name: "bash", args: {} }],
		};
		const turn2Op: CanonicalEvent = {
			kind: "operator_message",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 2,
			ts: "2026-07-05T00:02:00Z",
			text: "operator says something",
			mode: "queue",
			delivered: true,
		};
		const turn3Op: CanonicalEvent = {
			kind: "operator_message",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 3,
			ts: "2026-07-05T00:03:00Z",
			text: "another turn",
			mode: "queue",
			delivered: true,
		};
		const resultEvent: CanonicalEvent = {
			kind: "tool_result",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 4,
			ts: "2026-07-05T00:04:00Z",
			result: {
				name: "bash",
				toolCallId: "call-1",
				ok: true,
				source: "bash",
				preview: "done",
			},
		};

		const entries = [
			lightEntry(makeRow(1), callEvent),
			lightEntry(makeRow(2), turn2Op),
			lightEntry(makeRow(3), turn3Op),
			lightEntry(makeRow(4), resultEvent),
		];

		const openers = new Map<string, string>();
		for (const id of openerIds(callEvent)) {
			openers.set(id, "main:1");
		}

		const proj = buildProjection(0, entries.length, 0, entries, openers);

		expect(proj.anchorAt[3]).toBe(0);
		expect(proj.dependents.get(0)).toEqual([3]);
	});

	it("Turns start at each operator_message. A turn summary's steps counts the tool calls in it. failed counts results with ok:false", () => {
		const op1: CanonicalEvent = {
			kind: "operator_message",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 1,
			ts: "2026-07-05T00:01:00Z",
			text: "first turn",
			mode: "queue",
			delivered: true,
		};
		const step1: CanonicalEvent = {
			kind: "agent_step",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 2,
			ts: "2026-07-05T00:02:00Z",
			text: "step with calls",
			toolCalls: [
				{ toolCallId: "c1", name: "t1", args: {} },
				{ toolCallId: "c2", name: "t2", args: {} },
			],
		};
		const res1: CanonicalEvent = {
			kind: "tool_result",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 3,
			ts: "2026-07-05T00:03:00Z",
			result: {
				name: "t1",
				toolCallId: "c1",
				ok: false,
				source: "t1",
				preview: "failed",
			},
		};
		const op2: CanonicalEvent = {
			kind: "operator_message",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 4,
			ts: "2026-07-05T00:04:00Z",
			text: "second turn",
			mode: "queue",
			delivered: true,
		};
		const step2: CanonicalEvent = {
			kind: "agent_step",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 5,
			ts: "2026-07-05T00:05:00Z",
			text: "step with one call",
			toolCalls: [{ toolCallId: "c3", name: "t3", args: {} }],
		};

		const events = [op1, step1, res1, op2, step2];
		const entries = events.map((e, idx) => lightEntry(makeRow(idx + 1), e));
		const openers = new Map<string, string>();
		for (const e of events) {
			for (const id of openerIds(e)) {
				openers.set(id, `main:${e.seq}`);
			}
		}

		const proj = buildProjection(0, entries.length, 0, entries, openers);

		expect(proj.turns).toHaveLength(2);
		expect(proj.turns[0].summary.steps).toBe(2);
		expect(proj.turns[0].summary.failed).toBe(1);
		expect(proj.turns[1].summary.steps).toBe(1);
		expect(proj.turns[1].summary.failed).toBe(0);
	});

	it("stepsBefore[i] equals the tool calls before index i", () => {
		const step1: CanonicalEvent = {
			kind: "agent_step",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 1,
			ts: "2026-07-05T00:01:00Z",
			text: "",
			toolCalls: [
				{ toolCallId: "c1", name: "t1", args: {} },
				{ toolCallId: "c2", name: "t2", args: {} },
			],
		};
		const op: CanonicalEvent = {
			kind: "operator_message",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 2,
			ts: "2026-07-05T00:02:00Z",
			text: "interlude",
			mode: "queue",
			delivered: true,
		};
		const step2: CanonicalEvent = {
			kind: "agent_step",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 3,
			ts: "2026-07-05T00:03:00Z",
			text: "",
			toolCalls: [{ toolCallId: "c3", name: "t3", args: {} }],
		};

		const events = [step1, op, step2];
		const entries = events.map((e, idx) => lightEntry(makeRow(idx + 1), e));
		const openers = new Map<string, string>();
		for (const e of events) {
			for (const id of openerIds(e)) {
				openers.set(id, `main:${e.seq}`);
			}
		}

		const proj = buildProjection(0, entries.length, 0, entries, openers);

		expect(proj.stepsBefore[0]).toBe(0);
		expect(proj.stepsBefore[1]).toBe(2);
		expect(proj.stepsBefore[2]).toBe(2);
		expect(proj.stepsBefore[3]).toBe(3);
	});

	it("Entries given out of order come back sorted by (seq, branchId)", () => {
		const e1: CanonicalEvent = {
			kind: "operator_message",
			runId: RUN_ID,
			branchId: "branch-b",
			path: [],
			seq: 2,
			ts: "2026-07-05T00:02:00Z",
			text: "b2",
			mode: "queue",
			delivered: true,
		};
		const e2: CanonicalEvent = {
			kind: "operator_message",
			runId: RUN_ID,
			branchId: "branch-a",
			path: [],
			seq: 2,
			ts: "2026-07-05T00:02:00Z",
			text: "a2",
			mode: "queue",
			delivered: true,
		};
		const e3: CanonicalEvent = {
			kind: "operator_message",
			runId: RUN_ID,
			branchId: "main",
			path: [],
			seq: 1,
			ts: "2026-07-05T00:01:00Z",
			text: "m1",
			mode: "queue",
			delivered: true,
		};

		const entries = [
			lightEntry(makeRow(2, "branch-b", 1), e1),
			lightEntry(makeRow(2, "branch-a", 2), e2),
			lightEntry(makeRow(1, "main", 3), e3),
		];

		const proj = buildProjection(0, entries.length, 0, entries, new Map());

		expect(proj.entries.map((e) => e.key)).toEqual([
			"main:1",
			"branch-a:2",
			"branch-b:2",
		]);
	});
});
