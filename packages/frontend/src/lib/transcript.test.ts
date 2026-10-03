// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	deriveTranscript,
	runStepText,
	unmatchedPending,
	type TranscriptItem,
} from "./investigation-events";

const RUN_ID = "00000000-0000-0000-0000-000000000001";
const T0 = Date.parse("2026-09-30T14:27:00Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

let seq = 0;
const base = (s: number) => ({
	runId: RUN_ID,
	branchId: "run",
	path: [],
	seq: seq++,
	label: null,
	ts: at(s),
});

function step(
	s: number,
	text: string,
	calls: { id: string; name: string; args?: Record<string, unknown> }[] = [],
): CanonicalEvent {
	return {
		kind: "agent_step",
		...base(s),
		text,
		toolCalls: calls.map((c) => ({
			toolCallId: c.id,
			name: c.name,
			args: c.args ?? {},
		})),
	};
}

function result(
	s: number,
	id: string,
	category: "file" | "search" | null,
	ok = true,
): CanonicalEvent {
	return {
		kind: "tool_result",
		...base(s),
		result: {
			name: "tool",
			toolCategory: category,
			toolCallId: id,
			source: `tool(${id})`,
			ok,
			preview: "",
		},
	};
}

function operator(
	s: number,
	text: string,
	mode: "queue" | "now" = "queue",
	delivered = true,
): CanonicalEvent {
	return { kind: "operator_message", ...base(s), text, mode, delivered };
}

const kinds = (items: TranscriptItem[]) => items.map((i) => i.kind);
const ended = { status: "completed", live: false };

describe("deriveTranscript", () => {
	it("says so when a run kept no events", () => {
		expect(deriveTranscript([], T0, { run: ended })).toEqual([
			{ kind: "empty", key: "empty", text: "This investigation kept no events." },
		]);
	});

	it("still ends a failed run that kept no events with its error", () => {
		const items = deriveTranscript([], T0, {
			run: { status: "failed", live: false, error: "not logged in" },
		});
		expect(kinds(items)).toEqual(["end"]);
	});

	it("renders the agent's text as prose", () => {
		const items = deriveTranscript([step(1, "The p99 rise starts at 14:02.")], T0, {
			run: ended,
		});
		expect(items).toEqual([
			expect.objectContaining({
				kind: "prose",
				text: "The p99 rise starts at 14:02.",
			}),
		]);
	});

	it("folds a run of tool calls into one group with counts by category", () => {
		const items = deriveTranscript(
			[
				step(1, "", [
					{ id: "a", name: "Read a.ts" },
					{ id: "b", name: "Read b.ts" },
				]),
				result(2, "a", "file"),
				result(3, "b", "file"),
				step(4, "", [{ id: "c", name: "grep TTL" }]),
				result(5, "c", "search"),
				step(6, "", [{ id: "d", name: "git log" }]),
				result(7, "d", null, false),
				step(8, "The TTL changed."),
			],
			T0,
			{ run: ended },
		);
		expect(kinds(items)).toEqual(["tools", "prose"]);
		const tools = items[0] as Extract<TranscriptItem, { kind: "tools" }>;
		expect(tools.count).toBe(4);
		expect(tools.summary).toBe(
			"read 2 files, searched 1 pattern, ran 1 command",
		);
		expect(tools.failed).toBe(1);
		expect(tools.running).toBe(0);
		expect(tools.rows.length).toBeGreaterThan(0);
	});

	it("starts a new group after prose, and counts a call with no result as running", () => {
		const items = deriveTranscript(
			[
				step(1, "", [{ id: "a", name: "Read a.ts" }]),
				result(2, "a", "file"),
				step(3, "Now the deploy.", [{ id: "b", name: "Read deploy.md" }]),
			],
			T0,
			{ run: ended },
		);
		expect(kinds(items)).toEqual(["tools", "prose", "tools"]);
		const second = items[2] as Extract<TranscriptItem, { kind: "tools" }>;
		expect(second.running).toBe(1);
		expect(second.summary).toBe("1 running");
	});

	it("adds Thought for Ns before a step that followed a gap of 20s or more", () => {
		const items = deriveTranscript(
			[step(0, "First."), step(10, "Soon after."), step(48, "After a pause.")],
			T0,
			{ run: ended },
		);
		expect(kinds(items)).toEqual(["prose", "prose", "thought", "prose"]);
		expect(items[2]).toMatchObject({ kind: "thought", seconds: 38 });
	});

	it("names a delegated sub-agent inline instead of folding it", () => {
		const items = deriveTranscript(
			[
				step(1, "", [
					{
						id: "t",
						name: "Task",
						args: { description: "list every cache TTL constant" },
					},
				]),
			],
			T0,
			{ run: ended },
		);
		expect(items[0]).toMatchObject({
			kind: "line",
			text: "Delegated a sub-agent: list every cache TTL constant",
		});
	});

	it("shows the brief as delivered and a later message as answered once prose follows", () => {
		const items = deriveTranscript(
			[
				operator(0, "Focus on the cache layer."),
				step(5, "Looking at the cache."),
				operator(20, "Check the deploy at 13:58 first."),
				step(30, "Deploy 3b7e0d carries the TTL change."),
			],
			T0,
			{ run: ended },
		);
		const ops = items.filter((i) => i.kind === "operator");
		expect(ops.map((o) => o.kind === "operator" && o.state)).toEqual([
			"delivered",
			"answered",
		]);
	});

	it("marks sent-now and undelivered messages from their events", () => {
		const items = deriveTranscript(
			[
				step(0, "Working."),
				operator(5, "Stop reading logs.", "now"),
				operator(9, "Too late.", "queue", false),
			],
			T0,
			{ run: ended },
		);
		const ops = items.filter((i) => i.kind === "operator");
		expect(ops.map((o) => o.kind === "operator" && o.state)).toEqual([
			"sent_now",
			"not_delivered",
		]);
	});

	it("shows a message the API accepted as queued until its event arrives", () => {
		const pending = [
			{ id: "p1", text: "Check the deploy.", mode: "queue" as const, at: at(9) },
		];
		const live = { status: "running", live: true };
		const before = deriveTranscript([step(0, "Working.")], T0 + 10_000, {
			run: live,
			pending,
		});
		expect(before.find((i) => i.kind === "operator")).toMatchObject({
			state: "queued",
		});
		const after = deriveTranscript(
			[step(0, "Working."), operator(12, "Check the deploy.")],
			T0 + 13_000,
			{ run: live, pending },
		);
		expect(after.filter((i) => i.kind === "operator")).toHaveLength(1);
	});

	it("counts a trailing Thinking line while live, stale past 90s", () => {
		const live = { status: "running", live: true };
		const fresh = deriveTranscript([step(0, "Working.")], T0 + 38_000, {
			run: live,
		});
		expect(fresh.at(-1)).toMatchObject({
			kind: "thinking",
			seconds: 38,
			stale: false,
		});
		const stale = deriveTranscript([step(0, "Working.")], T0 + 130_000, {
			run: live,
		});
		expect(stale.at(-1)).toMatchObject({ kind: "thinking", stale: true });
	});

	it("ends a stopped run with who stopped it and how long it ran", () => {
		const items = deriveTranscript([step(0, "Working.")], T0, {
			run: {
				status: "cancelled",
				live: false,
				startedAt: at(0),
				completedAt: at(252),
			},
		});
		expect(items.at(-1)).toMatchObject({
			kind: "end",
			tone: "stale",
			detail: "after 4m 12s",
		});
		expect((items.at(-1) as { text: string }).text).toMatch(
			/^Stopped by you at \d\d:\d\d$/,
		);
	});

	it("ends a stopped run once, never also as Failed (walk f26)", () => {
		const cancelled: CanonicalEvent = {
			kind: "error",
			...base(40),
			message: "investigation cancelled",
		} as CanonicalEvent;
		const items = deriveTranscript([step(0, "Working."), cancelled], T0, {
			run: { status: "cancelled", live: false, completedAt: at(49) },
		});
		const ends = items.filter((i) => i.kind === "end");
		expect(ends).toHaveLength(1);
		expect(ends[0]).toMatchObject({ tone: "stale" });
		expect(JSON.stringify(items)).not.toContain("Failed");
	});

	it("ends a failed run with its error and the transcript path", () => {
		const items = deriveTranscript([step(0, "Working.")], T0, {
			run: { status: "failed", live: false, error: "not logged in", id: "r1" },
		});
		expect(items.at(-1)).toMatchObject({
			kind: "end",
			tone: "failed",
			text: "Failed: not logged in",
			path: "runs/r1/transcript.jsonl",
		});
	});
});

describe("runStepText", () => {
	it("names the tool in flight, then thinking, then rots past 90s", () => {
		const calling = [step(0, "", [{ id: "a", name: "Read src/x.ts" }])];
		expect(runStepText(calling, T0 + 2000)).toEqual({
			text: "read src/x.ts",
			stale: false,
		});
		const thinking = [...calling, result(1, "a", "file")];
		expect(runStepText(thinking, T0 + 3000)).toEqual({
			text: "thinking",
			stale: false,
		});
		expect(runStepText(thinking, T0 + 131_000)).toEqual({
			text: "no step for 2m 10s",
			stale: true,
		});
		expect(runStepText(thinking, T0, { streamLost: true })?.stale).toBe(true);
	});
});

describe("unmatchedPending", () => {
	const pending = (id: string, text: string, undelivered = false) => ({
		id,
		text,
		mode: "queue" as const,
		at: at(0),
		undelivered,
	});

	it("lets one event answer one pending message of the same text", () => {
		const left = unmatchedPending(
			[operator(1, "yes")],
			[pending("a", "yes"), pending("b", "yes ")],
		);
		expect(left.map((p) => p.id)).toEqual(["b"]);
	});

	it("keeps a refused message even when an earlier one with its text arrived", () => {
		const left = unmatchedPending(
			[operator(1, "yes")],
			[pending("a", "yes"), pending("b", "yes", true)],
		);
		expect(left.map((p) => p.id)).toEqual(["b"]);
	});
});
