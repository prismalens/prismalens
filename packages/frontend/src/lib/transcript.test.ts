// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	CanonicalEvent,
	PermissionAskOutcome,
} from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import { unfence } from "@/components/investigation/Transcript";
import {
	deriveTranscript,
	fileVerb,
	runStepText,
	summarizeTools,
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

function ask(
	s: number,
	askId = "00000000-0000-0000-0000-000000000010",
	title = "rm -rf /tmp",
	detail: string | null = "/tmp",
): CanonicalEvent {
	return {
		kind: "permission_ask",
		...base(s),
		askId,
		title,
		detail,
		toolKind: null,
		expiresAt: at(s + 600),
	} as CanonicalEvent;
}

function answer(
	s: number,
	askId = "00000000-0000-0000-0000-000000000010",
	outcome: PermissionAskOutcome = "approved",
): CanonicalEvent {
	return {
		kind: "permission_answer",
		...base(s),
		askId,
		outcome,
	} as CanonicalEvent;
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

	it("starts a new group after prose, and marks an unanswered call unfinished when ended", () => {
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
		expect(second.unfinished).toBe(true);
		expect(second.summary).toBe("1 not finished");
	});

	it("keeps an unanswered call running when the run is live", () => {
		const live = { status: "running", live: true };
		const items = deriveTranscript(
			[
				step(1, "", [{ id: "a", name: "Read a.ts" }]),
				result(2, "a", "file"),
				step(3, "Now the deploy.", [{ id: "b", name: "Read deploy.md" }]),
			],
			T0,
			{ run: live },
		);
		expect(kinds(items)).toEqual(["tools", "prose", "tools"]);
		const second = items[2] as Extract<TranscriptItem, { kind: "tools" }>;
		expect(second.running).toBe(1);
		expect(second.unfinished).toBeUndefined();
		expect(second.summary).toBe("1 running");
	});

	it("marks an unanswered call unfinished before a resumed operator_message even while live", () => {
		const live = { status: "running", live: true };
		const resumedEvent: CanonicalEvent = {
			...operator(4, "Check deploy again"),
			resumed: [{ name: "api", head: "1a2b3c4" }],
		} as CanonicalEvent;
		const items = deriveTranscript(
			[
				step(1, "", [{ id: "a", name: "Read a.ts" }]),
				result(2, "a", "file"),
				step(3, "Now the deploy.", [{ id: "b", name: "Read deploy.md" }]),
				resumedEvent,
			],
			T0,
			{ run: live },
		);
		const tools = items.filter((i) => i.kind === "tools") as Extract<
			TranscriptItem,
			{ kind: "tools" }
		>[];
		const second = tools[1];
		expect(second.running).toBe(1);
		expect(second.unfinished).toBe(true);
		expect(second.summary).toBe("1 not finished");
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

	it("shows the brief as the message that started the run and a later message as answered once prose follows", () => {
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
			"started",
			"answered",
		]);
	});

	it("sets operator message states: started for initial message, resumed when resumed set, delivered then answered for queued messages (#673)", () => {
		const chatItems = deriveTranscript([operator(0, "What failed?")], T0, {
			run: ended,
		});
		const chatOps = chatItems.filter((i) => i.kind === "operator");
		expect(chatOps).toHaveLength(1);
		expect(chatOps[0]).toMatchObject({ state: "started" });

		const resumedEvent: CanonicalEvent = {
			...operator(0, "Continue investigation"),
			resumed: [{ name: "repo", head: "3b7e0d" }],
		} as CanonicalEvent;
		const resumedItems = deriveTranscript([resumedEvent], T0, { run: ended });
		const resumedOps = resumedItems.filter((i) => i.kind === "operator");
		expect(resumedOps).toHaveLength(1);
		expect(resumedOps[0]).toMatchObject({ state: "resumed" });

		const deliveredItems = deriveTranscript(
			[
				operator(0, "Start here"),
				step(1, "First step"),
				operator(2, "Now check logs", "queue", true),
			],
			T0,
			{ run: ended },
		);
		const deliveredOps = deliveredItems.filter((i) => i.kind === "operator");
		expect(deliveredOps[1]).toMatchObject({ state: "delivered" });

		const answeredItems = deriveTranscript(
			[
				operator(0, "Start here"),
				step(1, "First step"),
				operator(2, "Now check logs", "queue", true),
				step(3, "Looking at logs"),
			],
			T0,
			{ run: ended },
		);
		const answeredOps = answeredItems.filter((i) => i.kind === "operator");
		expect(answeredOps[1]).toMatchObject({ state: "answered" });
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

	it("keeps card state waiting on a live run and suppresses thinking item (#673 w21)", () => {
		const items = deriveTranscript([step(0, "Working."), ask(10)], T0 + 15_000, {
			run: { status: "running", live: true },
		});
		const asks = items.filter((i) => i.kind === "ask");
		expect(asks).toHaveLength(1);
		expect(asks[0]).toMatchObject({
			kind: "ask",
			state: "waiting",
		});
		expect(items.some((i) => i.kind === "thinking")).toBe(false);
	});

	it.each([
		"approved",
		"denied",
		"timed_out",
		"stopped",
		"restarted",
	] as const)("sets ask state to %s when answered (#673 w21)", (outcome) => {
		const items = deriveTranscript(
			[step(0, "Working."), ask(10, "ask-1"), answer(20, "ask-1", outcome)],
			T0 + 25_000,
			{ run: { status: "running", live: true } },
		);
		const asks = items.filter((i) => i.kind === "ask");
		expect(asks).toHaveLength(1);
		expect(asks[0]).toMatchObject({
			kind: "ask",
			state: outcome,
		});
	});

	it("marks an unanswered ask as ended when the run is not live (#673 w21)", () => {
		const items = deriveTranscript([step(0, "Working."), ask(10)], T0 + 20_000, {
			run: ended,
		});
		const asks = items.filter((i) => i.kind === "ask");
		expect(asks).toHaveLength(1);
		expect(asks[0]).toMatchObject({
			kind: "ask",
			state: "ended",
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

	it("is not stale for a 10-minute-old permission_ask (#673 w21)", () => {
		const events = [ask(0)];
		expect(runStepText(events, T0 + 600_000)).toEqual({
			text: "waiting for your approval",
			stale: false,
		});
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

describe("summarizeTools", () => {
	it("summarizes file results in order: read, wrote, edited, deleted, moved (#673)", () => {
		const results = [
			{ name: "Write /tmp/x", toolCategory: "file" as const, toolCallId: "1", source: "1", ok: true, preview: "" },
			{ name: "Edit `/a.ts`", toolCategory: "file" as const, toolCallId: "2", source: "2", ok: true, preview: "" },
			{ name: "Read /b.ts", toolCategory: "file" as const, toolCallId: "3", source: "3", ok: true, preview: "" },
		];
		expect(summarizeTools(results)).toBe("read 1 file, wrote 1 file, edited 1 file");
	});

	it("formats deleted and moved file counts in order", () => {
		const results = [
			{ name: "rm /tmp/old", toolCategory: "file" as const, toolCallId: "1", source: "1", ok: true, preview: "" },
			{ name: "mv /tmp/a /tmp/b", toolCategory: "file" as const, toolCallId: "2", source: "2", ok: true, preview: "" },
			{ name: "write /tmp/new", toolCategory: "file" as const, toolCallId: "3", source: "3", ok: true, preview: "" },
			{ name: "read /tmp/b", toolCategory: "file" as const, toolCallId: "4", source: "4", ok: true, preview: "" },
			{ name: "edit /tmp/b", toolCategory: "file" as const, toolCallId: "5", source: "5", ok: true, preview: "" },
		];
		expect(summarizeTools(results)).toBe(
			"read 1 file, wrote 1 file, edited 1 file, deleted 1 file, moved 1 file",
		);
	});

	it("formats unanswered calls as not finished when ended is true", () => {
		const results = [
			{ name: "read /tmp/b", toolCategory: "file" as const, toolCallId: "1", source: "1", ok: true, preview: "" },
			null,
		];
		expect(summarizeTools(results, { ended: true })).toBe("read 1 file, 1 not finished");
	});
});

describe("fileVerb", () => {
	it("identifies file verbs from tool names and defaults to read (#673)", () => {
		expect(fileVerb("Write /tmp/x")).toBe("write");
		expect(fileVerb("`Edit` x")).toBe("edit");
		expect(fileVerb("Read /b.ts")).toBe("read");
		expect(fileVerb("grep TTL")).toBe("read");
		expect(fileVerb("editor_view /x")).toBe("read");
		expect(fileVerb("created_files")).toBe("read");
		expect(fileVerb("str_replace_editor")).toBe("edit");
		expect(fileVerb("write_file /x")).toBe("write");
	});
});

describe("unfence", () => {
	it("strips code fences including language tags and leaves unfenced text unchanged (#673)", () => {
		expect(unfence("```\nExit code 1\n```")).toBe("Exit code 1");
		expect(unfence("```bash\nls\n```")).toBe("ls");
		expect(unfence("no fences")).toBe("no fences");
	});
});


describe("an Ask on a stopped reportless investigation (#804 OBJ-028)", () => {
	const stop = (s: number): CanonicalEvent =>
		({ kind: "error", ...base(s), message: "investigation cancelled" }) as CanonicalEvent;
	const failure = (s: number, message: string): CanonicalEvent =>
		({ kind: "error", ...base(s), message }) as CanonicalEvent;
	const stopped = {
		status: "cancelled",
		live: false,
		kind: "investigation",
		startedAt: at(0),
		completedAt: at(28),
		continuable: true,
		lastTurnOutcome: "error",
	};
	const endTexts = (items: TranscriptItem[]) =>
		items.flatMap((i) => (i.kind === "end" ? [i.text] : []));

	it("shows the Ask's own error under it, after the original Stop where it happened", () => {
		const items = deriveTranscript(
			[step(0, "Working."), stop(28), operator(600, "What did you find?"), failure(610, "the agent crashed")],
			T0,
			{ run: stopped },
		);
		const texts = endTexts(items);
		expect(texts).toHaveLength(2);
		expect(texts[0]).toMatch(/^Stopped by you at \d\d:\d\d$/);
		expect(texts[1]).toBe("The agent stopped: the agent crashed");
		// The Stop sits before the question, the error after it.
		const order = items.map((i) => (i.kind === "end" ? i.text : i.kind));
		expect(order.indexOf("operator")).toBeGreaterThan(order.indexOf(texts[0] as string));
		expect(order.at(-1)).toBe("The agent stopped: the agent crashed");
		expect(items.at(-1)).toMatchObject({
			hint: "Investigate to finish the report, or ask about what it found.",
		});
	});

	it("with the Ask's terminal event dropped, still says the last message ended in an error", () => {
		const items = deriveTranscript(
			[step(0, "Working."), stop(28), operator(600, "What did you find?")],
			T0,
			{ run: stopped },
		);
		const texts = endTexts(items);
		expect(texts[0]).toMatch(/^Stopped by you at /);
		expect(texts.at(-1)).toBe("The agent stopped on your last message");
		expect(items.at(-1)?.kind).toBe("end");
	});

	// The follow-up's own first message marks it, so a dropped Stop event changes nothing (#804 OBJ-028).
	const ask = (s: number): CanonicalEvent =>
		({ ...operator(s, "What did you find?"), resumed: [] }) as CanonicalEvent;
	it.each([
		["present", [failure(610, "the agent crashed")], "The agent stopped: the agent crashed"],
		["dropped", [], "The agent stopped on your last message"],
	] as const)("with the Stop's own event dropped and the Ask's error %s, the standing precedes the Ask and its end follows it", (_case, tail, last) => {
		const items = deriveTranscript([step(0, "Working."), ask(600), ...tail], T0, { run: stopped });
		const order = items.map((i) => (i.kind === "end" ? i.text : i.kind));
		const standing = order.findIndex((t) => /^Stopped by you at /.test(t));
		expect(standing).toBeGreaterThan(-1);
		expect(standing).toBeLessThan(order.indexOf("operator"));
		expect(order.at(-1)).toBe(last);
		expect(endTexts(items)).toHaveLength(2);
	});

	it("an answered Ask adds no end line", () => {
		const items = deriveTranscript(
			[step(0, "Working."), stop(28), operator(600, "What did you find?"), step(610, "The pool.")],
			T0,
			{ run: { ...stopped, lastTurnOutcome: "answered" } },
		);
		expect(endTexts(items)).toHaveLength(1);
	});
});

describe("Send now carries the queued message (#673 walk 4)", () => {
	it("carries an immediately preceding delivered queued message into mode now (#673 walk 4)", () => {
		// A and B both become mode now and then answered once the agent answers.
		const items = deriveTranscript(
			[
				operator(0, "Investigate cache issue"),
				step(1, "Starting investigation."),
				operator(2, "Message A", "queue", true),
				operator(2, "Message B", "now", true),
				step(3, "Answering both messages."),
			],
			T0,
			{ run: ended },
		);
		const ops = items.filter((i) => i.kind === "operator") as Extract<
			TranscriptItem,
			{ kind: "operator" }
		>[];
		expect(ops).toHaveLength(3);
		expect(ops[1]).toMatchObject({
			text: "Message A",
			mode: "now",
			state: "answered",
		});
		expect(ops[2]).toMatchObject({
			text: "Message B",
			mode: "now",
			state: "answered",
		});
	});

	it("does not carry a queued message if agent prose intervenes (#673 walk 4)", () => {
		// Agent prose between A and B leaves A in mode queue.
		const items = deriveTranscript(
			[
				operator(0, "Investigate cache issue"),
				step(1, "Starting investigation."),
				operator(2, "Message A", "queue", true),
				step(3, "Intermediate prose."),
				operator(4, "Message B", "now", true),
			],
			T0,
			{ run: ended },
		);
		const ops = items.filter((i) => i.kind === "operator") as Extract<
			TranscriptItem,
			{ kind: "operator" }
		>[];
		expect(ops).toHaveLength(3);
		expect(ops[1]).toMatchObject({
			text: "Message A",
			mode: "queue",
			state: "answered",
		});
		expect(ops[2]).toMatchObject({
			text: "Message B",
			mode: "now",
			state: "sent_now",
		});
	});

	it("does not carry over the run brief when send now arrives directly after it (#673 walk 4)", () => {
		// The brief keeps state started and mode queue because it is not delivered.
		const items = deriveTranscript(
			[
				operator(0, "Initial brief", "queue", true),
				operator(1, "Message B", "now", true),
			],
			T0,
			{ run: ended },
		);
		const ops = items.filter((i) => i.kind === "operator") as Extract<
			TranscriptItem,
			{ kind: "operator" }
		>[];
		expect(ops).toHaveLength(2);
		expect(ops[0]).toMatchObject({
			text: "Initial brief",
			mode: "queue",
			state: "started",
		});
		expect(ops[1]).toMatchObject({
			text: "Message B",
			mode: "now",
			state: "sent_now",
		});
	});

	it("does not carry an undelivered queued message preceding send now (#673 walk 4)", () => {
		// Message A with delivered false keeps mode queue and state not_delivered.
		const items = deriveTranscript(
			[
				operator(0, "Initial brief"),
				step(1, "Starting investigation."),
				operator(2, "Message A", "queue", false),
				operator(3, "Message B", "now", true),
			],
			T0,
			{ run: ended },
		);
		const ops = items.filter((i) => i.kind === "operator") as Extract<
			TranscriptItem,
			{ kind: "operator" }
		>[];
		expect(ops).toHaveLength(3);
		expect(ops[1]).toMatchObject({
			text: "Message A",
			mode: "queue",
			state: "not_delivered",
		});
		expect(ops[2]).toMatchObject({
			text: "Message B",
			mode: "now",
			state: "sent_now",
		});
	});
});

