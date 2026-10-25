// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { PERMISSION_ASK_OUTCOMES } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import walk8 from "./__fixtures__/walk8-report-drafts.json";
import {
	deriveTranscript,
	type PendingMessage,
	shareItems,
	type TranscriptItem,
} from "./investigation-events";

type Opts = NonNullable<Parameters<typeof deriveTranscript>[1]>;

const RUN_ID = "00000000-0000-0000-0000-000000000001";
const T0 = Date.parse("2026-10-20T10:00:00Z");
const uuid = (n: number) =>
	`00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** A small seeded generator, so a failing sequence can be replayed by its seed. */
function rng(seed: number) {
	let a = seed >>> 0;
	const next = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		next,
		int: (n: number) => Math.floor(next() * n),
		pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T,
	};
}

function stream(branchId = "main") {
	let seq = 0;
	let ts = T0;
	return (gapS = 1) => {
		ts += gapS * 1000;
		return {
			runId: RUN_ID,
			branchId,
			path: [] as string[],
			seq: seq++,
			label: null,
			ts: new Date(ts).toISOString(),
		};
	};
}

/** The e2e journeys' shape (`makeToolStepEvents`): a step with one call, then its result. */
function toolSteps(count: number): CanonicalEvent[] {
	const base = stream();
	return Array.from({ length: count }, (_, k) => {
		const i = k + 1;
		const id = `call-tool-${i}`;
		const file = i % 2 === 0;
		return [
			{
				kind: "agent_step",
				...base(i % 9 === 0 ? 30 : 1),
				text: i % 3 === 0 ? `Step ${i} text` : "",
				toolCalls: [
					{
						toolCallId: id,
						name: file ? "read_file" : "bash",
						args: file ? { path: `repo/file-${i}.txt` } : { command: `cmd-${i}` },
					},
				],
			},
			{
				kind: "tool_result",
				...base(),
				result: {
					toolCallId: id,
					name: file ? "read_file" : "bash",
					toolCategory: file ? "file" : "logs",
					ok: i !== 3,
					source: file ? `read_file(repo/file-${i}.txt)` : `cmd-${i}`,
					preview: `preview output for call ${i}`,
					error: i === 3 ? "command failed" : undefined,
				},
			},
		] satisfies CanonicalEvent[];
	}).flat();
}

/** The walk-8 report drafts as an Ask's answers, with a follow-up between them. */
function walk8Run(): CanonicalEvent[] {
	const base = stream();
	return [
		{
			kind: "operator_message",
			...base(),
			text: "Why did p99 rise?",
			mode: "queue",
			delivered: true,
		},
		{ kind: "agent_step", ...base(), text: walk8.run1Answer, toolCalls: [] },
		{ kind: "branch_done", ...base(), reason: "submitted" },
		{
			kind: "operator_message",
			...base(40),
			text: "And the restarts?",
			mode: "queue",
			delivered: true,
			resumed: [{ name: "repo", head: "a".repeat(40) }],
			followUp: "chat",
		},
		{ kind: "agent_step", ...base(), text: walk8.run2Answer, toolCalls: [] },
	];
}

const report = (seq: number): CanonicalEvent => ({
	kind: "report",
	runId: RUN_ID,
	seq,
	ts: new Date(T0 + seq * 1000).toISOString(),
	report: {
		summary: "The pool ran dry",
		rootCause: null,
		rootCauseCategory: null,
		hypotheses: [],
		ruledOut: [],
		coverage: { queried: [], notQueried: [] },
		nextSteps: [],
	},
});

/** Any event the derivation reads, in an order a run could plausibly record. */
function randomRun(seed: number, length: number): CanonicalEvent[] {
	const r = rng(seed);
	const base = stream(r.next() < 0.2 ? "b2" : "main");
	const open: string[] = [];
	const asks: string[] = [];
	const queued: string[] = [];
	let n = 0;
	const out: CanonicalEvent[] = [];
	for (let i = 0; i < length; i++) {
		const roll = r.next();
		const gap = r.next() < 0.1 ? 25 : 1;
		if (roll < 0.35) {
			const calls: {
				toolCallId: string;
				name: string;
				args: Record<string, unknown>;
			}[] = Array.from({ length: r.int(3) }, () => {
				const id = `c${n++}`;
				open.push(id);
				return {
					toolCallId: id,
					name: r.pick(["bash", "read_file", "Task", "grep"]),
					args: { command: `x ${n}` },
				};
			});
			// A re-announced call joins the group that already lists it.
			if (open.length > 0 && r.next() < 0.1)
				calls.push({ toolCallId: r.pick(open), name: "bash", args: {} });
			out.push({
				kind: "agent_step",
				...base(gap),
				text: r.pick(["", "", "Checking the pool.", walk8.run1Answer]),
				toolCalls: calls,
			});
		} else if (roll < 0.6) {
			const id = open.length && r.next() < 0.85 ? open.splice(r.int(open.length), 1)[0] : `late${n++}`;
			out.push({
				kind: "tool_result",
				...base(gap),
				result: {
					toolCallId: id ?? "none",
					name: "bash",
					toolCategory: r.pick(["file", "logs", null] as const),
					ok: r.next() < 0.85,
					source: `bash ${id}`,
					preview: "out",
				},
			});
		} else if (roll < 0.68) {
			const messageId = queued.length && r.next() < 0.6 ? queued.shift() : undefined;
			out.push({
				kind: "operator_message",
				...base(gap),
				text: `note ${i}`,
				mode: r.pick(["queue", "now"] as const),
				delivered: r.next() < 0.9,
				...(messageId ? { messageId } : {}),
				...(r.next() < 0.1
					? {
							resumed: [{ name: "repo", head: "b".repeat(40) }],
							followUp: r.pick(["chat", "continue"] as const),
						}
					: {}),
			});
		} else if (roll < 0.73) {
			const messageId = uuid(1000 + i);
			queued.push(messageId);
			out.push({ kind: "message_queued", ...base(gap), messageId, text: `queued ${i}` });
		} else if (roll < 0.79) {
			const askId = uuid(i);
			asks.push(askId);
			out.push({
				kind: "permission_ask",
				...base(gap),
				askId,
				title: "rm -rf /tmp/x",
				detail: "/tmp/x",
				toolKind: r.pick(["execute", "read", null]),
				expiresAt: new Date(T0 + 3_600_000).toISOString(),
			});
		} else if (roll < 0.85) {
			const askId = asks.length && r.next() < 0.7 ? asks.shift() : uuid(5000 + i);
			out.push({
				kind: "permission_answer",
				...base(gap),
				askId: askId ?? uuid(9999),
				outcome: r.pick(PERMISSION_ASK_OUTCOMES),
				title: "edit src/a.ts",
				toolKind: r.pick(["edit", "read", null]),
			});
		} else if (roll < 0.89) {
			out.push({
				kind: "session_config",
				...base(gap),
				option: r.pick(["model", "effort"] as const),
				value: r.pick(["haiku", "high"]),
				accepted: r.next() < 0.8,
			});
		} else if (roll < 0.94) {
			out.push({ kind: "branch_done", ...base(gap), reason: "submitted" });
		} else if (roll < 0.97) {
			out.push({ kind: "error", ...base(gap), message: r.pick(["boom", "investigation cancelled"]) });
		} else {
			out.push(report(base(gap).seq));
		}
	}
	return out;
}

const RUNS: Record<string, Opts["run"]> = {
	live: { id: RUN_ID, status: "running", live: true, kind: "investigation" },
	stopping: { id: RUN_ID, status: "running", live: true, stopRequested: true },
	completed: { id: RUN_ID, status: "completed", live: false, hasReport: true, continuable: true },
	failed: { id: RUN_ID, status: "failed", live: false, error: "agent exited", completedAt: new Date(T0).toISOString() },
	cancelled: {
		id: RUN_ID,
		status: "cancelled",
		live: false,
		startedAt: new Date(T0).toISOString(),
		completedAt: new Date(T0 + 252_000).toISOString(),
		lastTurnOutcome: "stopped",
	},
	chat: { id: RUN_ID, status: "completed", live: false, kind: "chat" },
};

const PENDING: PendingMessage[] = [
	{ id: "p1", text: "note 3", mode: "queue", at: new Date(T0).toISOString(), attachments: [] },
	{ id: "p2", text: "go now", mode: "now", at: new Date(T0).toISOString(), attachments: [] },
];

/**
 * Feeds `events` one at a time the way the run page does: a full derivation
 * shared against the previous result. Each step must equal a fresh full
 * derivation, and every item deep-equal to its predecessor must be that object.
 */
function expectParity(events: CanonicalEvent[], opts: Opts) {
	let prev: TranscriptItem[] = [];
	for (let k = 1; k <= events.length; k++) {
		const full = deriveTranscript(events.slice(0, k), opts);
		const next = shareItems(prev, deriveTranscript(events.slice(0, k), opts));
		expect(next).toEqual(full);
		const before = new Map(prev.map((i) => [i.key, i]));
		for (const item of next) {
			const old = before.get(item.key);
			if (old && JSON.stringify(old) === JSON.stringify(item)) expect(item).toBe(old);
			if (old && item === old) expect(item).toEqual(full.find((f) => f.key === item.key));
		}
		prev = next;
	}
	return prev;
}

describe("incremental transcript equals the full derivation (#874)", () => {
	it("over the e2e journeys' tool steps, live then ended", () => {
		const events = toolSteps(30);
		const live = expectParity(events, { run: RUNS.live });
		// The run ends: the same events under the ended run, shared against the live result.
		const ended = shareItems(live, deriveTranscript(events, { run: RUNS.completed }));
		expect(ended).toEqual(deriveTranscript(events, { run: RUNS.completed }));
		const firstGroup = live.find((i) => i.kind === "tools");
		expect(ended.find((i) => i.key === firstGroup?.key)).toBe(firstGroup);
	});

	it("over the walk-8 report drafts and their follow-up", () => {
		for (const run of [RUNS.chat, RUNS.completed, RUNS.live])
			expectParity(walk8Run(), { run, pending: PENDING });
	});

	it("over 150 random event sequences under every run state", () => {
		const states = Object.values(RUNS);
		for (let seed = 1; seed <= 150; seed++) {
			const run = states[seed % states.length];
			expectParity(randomRun(seed, 10 + (seed % 50)), {
				run,
				pending: seed % 3 === 0 ? PENDING : [],
				modelName: (id) => `Model ${id}`,
			});
		}
	}, 60_000);

	it("keeps the whole array when nothing changed, and a new tool result moves only its group and the tail", () => {
		const events = toolSteps(10);
		const open = events.slice(0, -1);
		const before = shareItems([], deriveTranscript(open, { run: RUNS.live }));
		expect(shareItems(before, deriveTranscript(open, { run: RUNS.live }))).toBe(before);
		const after = shareItems(before, deriveTranscript(events, { run: RUNS.live }));
		const moved = after.filter((i) => !before.includes(i)).map((i) => i.kind);
		expect(moved).toEqual(["tools", "thinking"]);
	});
});
