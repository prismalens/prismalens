// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	CanonicalEvent,
	EventFullSchema,
	OpenThread,
	SearchEvents,
	SearchMessages,
	ThreadIndex,
	ThreadPage,
} from "@prismalens/contracts";
import type { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScenarioApp } from "../scenarios/support/scenario-app.js";

// The thread window over real SQLite (#1101 categories 12-14): the trigger's ordinals,
// pages, folds, anchors, cuts, the index, the open state and find, through the API.
const pl = new ScenarioApp();
const RUN = "0b3c2f1e-1111-4222-8333-444444444444";
const TURNS = 20;
const ASK = "5a3c2f1e-1111-4222-8333-444444444444";
const QUEUED = "6a3c2f1e-1111-4222-8333-444444444444";

const at = (n: number) => new Date(Date.UTC(2026, 10, 12, 8, 0, n)).toISOString();
const base = (seq: number) => ({
	runId: RUN,
	branchId: "main",
	path: [] as string[],
	seq,
	ts: at(seq),
});

/** 20 turns: a message, a call, its result, an answer; plus the marks and state kinds. */
function events(): CanonicalEvent[] {
	const out: CanonicalEvent[] = [];
	let seq = 0;
	for (let t = 1; t <= TURNS; t++) {
		out.push({
			kind: "operator_message",
			...base(seq++),
			text: t === 3 ? "Turn 3 asks about İstanbul" : `Turn ${t} needle`,
			mode: "queue",
			delivered: true,
		});
		out.push({
			kind: "agent_step",
			...base(seq++),
			text: "",
			toolCalls: [
				{ toolCallId: `call-${t}`, name: "Bash", args: { command: `ls ${t}` } },
			],
		});
		// Turn 1's result arrives late, two turns on: it still belongs beside its call.
		if (t !== 1)
			out.push({
				kind: "tool_result",
				...base(seq++),
				result: {
					name: "Bash",
					toolCallId: `call-${t}`,
					source: `ls ${t}`,
					ok: t !== 4,
					error: t === 4 ? "exit 1" : null,
					preview: t === 5 ? "x".repeat(10_000) : `out ${t}`,
				},
			});
		if (t === 3)
			out.push({
				kind: "tool_result",
				...base(seq++),
				result: {
					name: "Bash",
					toolCallId: "call-1",
					source: "ls 1",
					ok: true,
					error: null,
					preview: "late out 1",
				},
			});
		if (t === 6)
			out.push({
				kind: "usage_limit",
				...base(seq++),
				agent: "claude-code",
				text: "Usage limit reached",
				resetsAt: at(9999),
			});
		if (t === 7)
			out.push({
				kind: "error",
				...base(seq++),
				message: "Invalid API key (401)",
			});
		if (t === 8) {
			out.push({
				kind: "permission_ask",
				...base(seq++),
				askId: ASK,
				title: "Run ls",
				detail: "ls",
				toolKind: "execute",
				expiresAt: at(99_999),
			});
			out.push({ kind: "branch_done", ...base(seq++), reason: "submitted" });
		}
		if (t === 9)
			out.push({
				kind: "finding_recorded",
				...base(seq++),
				finding: {
					type: "hypothesis",
					id: "h1",
					statement: "The pool is too small",
					status: "supported",
					evidenceIds: [],
					at: at(seq),
				},
			});
		out.push({
			kind: "agent_step",
			...base(seq++),
			text: `Turn ${t} answer`,
			toolCalls: [],
		});
	}
	out.push({
		kind: "message_queued",
		...base(seq++),
		messageId: QUEUED,
		text: "Then the cache",
	});
	return out;
}

let thread = "";
let other = "";
let recorded: CanonicalEvent[] = [];

async function insert(id: string, list: CanonicalEvent[]) {
	const prisma = await pl.prisma();
	for (const e of list)
		await prisma.investigationEvent.create({
			data: {
				investigationId: id,
				seq: e.seq,
				branchId: "branchId" in e ? e.branchId : "__report__",
				event: JSON.stringify(e),
			},
		});
}

beforeAll(async () => {
	await pl.boot();
	const prisma = await pl.prisma();
	const make = (title: string) =>
		prisma.investigation.create({
			data: { kind: "chat", status: "completed", title, lastTurnOutcome: "answered" },
		});
	thread = (await make("Window thread")).id;
	other = (await make("Other thread")).id;
	recorded = events();
	await insert(thread, recorded);
	await insert(other, [
		{
			kind: "operator_message",
			...base(0),
			text: "Another needle here",
			mode: "queue",
			delivered: true,
		},
	]);
}, 60_000);
afterAll(async () => {
	await pl.dispose();
});

describe("The thread window on SQLite (#1101)", () => {
	it("stamps one commit ordinal per row, and the index counts every event", async () => {
		const index = await pl.api<ThreadIndex>(`/investigations/${thread}/window/index`);
		expect(index).toMatchObject({
			gen: 0,
			revision: recorded.length,
			total: recorded.length,
			lost: 0,
		});
		expect(index.turns).toHaveLength(TURNS);
		expect(index.entries.filter((e) => e[2]).map((e) => e[2])).toEqual([
			"usage_limit",
			"auth",
		]);
		expect(index.turns[0]).toMatchObject({ key: "main:0", author: "you", steps: 1 });
	});

	it("opens at the tail with 12 whole turns, older turns folded, and the open state", async () => {
		const open = await pl.api<OpenThread>(
			`/investigations/${thread}/window?fold=true`,
		);
		const page = open.page;
		const turnKeys = open.index.turns.map((t) => t.key);
		expect(page.lo).toBe(turnKeys[TURNS - 12]);
		expect(page.hi).toBe(`main:${recorded.length - 1}`);
		expect(page).toMatchObject({ hasBefore: true, hasAfter: false, target: null });
		// Every finished turn in the page folds; the last one stays open.
		expect(page.folded.map((f) => f.turnKey)).toEqual(turnKeys.slice(TURNS - 12, TURNS - 1));
		expect(open.landing).toBeNull();
		expect(open.state.queue).toEqual([
			{ messageId: QUEUED, text: "Then the cache", at: at(recorded.length - 1) },
		]);
		// The ask's turn ended unanswered: it no longer waits.
		expect(open.state.openAsks).toEqual([]);
		expect(open.state.hypotheses.map((h) => h.statement)).toEqual([
			"The pool is too small",
		]);
	});

	it("pages back from the window's start, with a late result beside its earlier call", async () => {
		const open = await pl.api<OpenThread>(`/investigations/${thread}/window`);
		const before = await pl.api<ThreadPage>(
			`/investigations/${thread}/window/page?gen=0&before=${encodeURIComponent(open.page.lo ?? "")}`,
		);
		expect(before).toMatchObject({ lo: "main:0", hasBefore: false, hasAfter: true });
		const keys = before.items.map((i) => i.key);
		const call = keys.indexOf("main:1");
		const late = before.items.find(
			(i) =>
				i.event.kind === "tool_result" && i.event.result.toolCallId === "call-1",
		);
		expect(call).toBe(1);
		expect(late?.event.seq).toBe(10);
		expect(before.context).toEqual({
			stepsBefore: 0,
			endsBefore: 0,
			operatorsBefore: 0,
			agentBefore: false,
		});
	});

	it("opens around an item by its seq alone, and pages after it", async () => {
		const open = await pl.api<OpenThread>(`/investigations/${thread}/window?at=12`);
		expect(open.landing).toBe("main:12");
		expect(open.page.target).toBe("main:12");
		expect(open.page.items.map((i) => i.key)).toContain("main:12");
		const after = await pl.api<ThreadPage>(
			`/investigations/${thread}/window/page?gen=0&after=${encodeURIComponent(open.page.hi ?? "")}`,
		);
		expect(after.hasAfter).toBe(false);
		expect(after.hi).toBe(`main:${recorded.length - 1}`);
	});

	it("cuts a long output for the page and reads it whole on request", async () => {
		const index = await pl.api<ThreadIndex>(`/investigations/${thread}/window/index`);
		const turn5 = index.turns[4]?.key ?? "";
		const page = await pl.api<ThreadPage>(
			`/investigations/${thread}/window/page?gen=0&turn=${encodeURIComponent(turn5)}`,
		);
		const cut = page.items.find((i) => i.cut);
		expect(cut?.cut).toEqual([{ path: "result.preview", bytes: 10_000 }]);
		const full = await pl.api<z.infer<typeof EventFullSchema>>(
			`/investigations/${thread}/window/event?gen=0&key=${encodeURIComponent(cut?.key ?? "")}`,
		);
		expect(
			full.event.kind === "tool_result" ? full.event.result.preview.length : 0,
		).toBe(10_000);
	});

	it("refuses a page asked for at another generation", async () => {
		await expect(
			pl.api(`/investigations/${thread}/window/page?gen=7&before=main:5`),
		).rejects.toThrow(/409/);
	});

	it("counts every hit on the server, by scope and case, Unicode folding included", async () => {
		const search = (q: string, extra = "") =>
			pl.api<SearchEvents>(
				`/investigations/${thread}/search?q=${encodeURIComponent(q)}${extra}`,
			);
		const needle = await search("needle");
		expect(needle).toMatchObject({ total: TURNS - 1, items: TURNS - 1, next: null });
		expect(needle.hits[0]).toEqual(["main:0", 1]);
		expect((await search("NEEDLE", "&caseSensitive=true")).total).toBe(0);
		expect((await search("needle", "&caseSensitive=false")).total).toBe(TURNS - 1);
		expect((await search("out 17", "&scope=tools")).total).toBe(1);
		expect((await search("out 17", "&scope=mine")).total).toBe(0);
		// `İ` lowercases to i plus a combining dot: SQLite's lower() misses it, so an ASCII
		// query ending in i must still reach that row, and plain "istanbul" must not match.
		expect((await search("asks about i")).hits).toEqual([["main:7", 1]]);
		expect((await search("istanbul")).total).toBe(0);
		expect((await search("İSTANBUL")).total).toBe(1);
		const paged = await search("needle", "&from=10");
		expect(paged.hits).toHaveLength(TURNS - 1 - 10);
	});

	it("finds message text across threads, newest activity first, with no more to read", async () => {
		const found = await pl.api<SearchMessages>(
			"/threads/search-messages?q=needle",
		);
		expect(found.hits.map((h) => h.threadId).sort()).toEqual([thread, other].sort());
		expect(found.hits.find((h) => h.threadId === other)).toMatchObject({
			key: "main:0",
			count: 1,
			snippet: "Another needle here",
		});
		expect(found.next).toBeNull();
	});

	it("extends a cached projection with rows committed after it", async () => {
		const first = await pl.api<ThreadIndex>(`/investigations/${thread}/window/index`);
		const seq = recorded.length + 100;
		await insert(thread, [
			{
				kind: "operator_message",
				...base(seq),
				text: "One more needle",
				mode: "queue",
				delivered: true,
			},
		]);
		const next = await pl.api<ThreadIndex>(`/investigations/${thread}/window/index`);
		expect(next.revision).toBe(first.revision + 1);
		expect(next.turns).toHaveLength(TURNS + 1);
		expect(next.entries.at(-1)?.[0]).toBe(`main:${seq}`);
	});
});

describe("The thread window's edges on SQLite (#1101)", () => {
	let empty = "";
	let big = "";
	const BIG = 300;

	beforeAll(async () => {
		const prisma = await pl.prisma();
		const make = (title: string) =>
			prisma.investigation.create({
				data: { kind: "chat", status: "completed", title },
			});
		empty = (await make("Empty thread")).id;
		big = (await make("One oversized turn")).id;
		const list: CanonicalEvent[] = [
			{
				kind: "operator_message",
				...base(0),
				text: 'Look "everywhere"',
				mode: "queue",
				delivered: true,
			},
		];
		for (let i = 1; i <= BIG; i++)
			list.push({
				kind: "tool_result",
				...base(i),
				result: {
					name: "Read",
					toolCallId: `big-${i}`,
					source: `read ${i}`,
					ok: true,
					error: null,
					preview: `${"y".repeat(3000)} row ${i}`,
				},
			});
		await insert(big, list);
	}, 60_000);

	it("opens an empty thread with an empty page and no turns", async () => {
		const open = await pl.api<OpenThread>(`/investigations/${empty}/window`);
		expect(open.page).toMatchObject({
			lo: null,
			hi: null,
			items: [],
			hasBefore: false,
			hasAfter: false,
		});
		expect(open.index).toMatchObject({ total: 0, turns: [], entries: [] });
	});

	it("opens at the tail for an unknown item or position, and an unknown page anchor reads empty", async () => {
		const unknown = await pl.api<OpenThread>(
			`/investigations/${thread}/window?at=main:99999`,
		);
		expect(unknown.landing).toBeNull();
		const named = await pl.api<OpenThread>(
			`/investigations/${thread}/window?position=unread`,
		);
		expect(named.landing).toBeNull();
		for (const side of ["before", "after", "around", "turn"]) {
			const page = await pl.api<ThreadPage>(
				`/investigations/${thread}/window/page?gen=0&${side}=main:99999`,
			);
			expect(page.items).toEqual([]);
		}
	});

	it("reads no event whole for an unknown key or another generation", async () => {
		await expect(
			pl.api(`/investigations/${thread}/window/event?gen=0&key=main:99999`),
		).rejects.toThrow(/404/);
		await expect(
			pl.api(`/investigations/${thread}/window/event?gen=3&key=main:0`),
		).rejects.toThrow(/409/);
	});

	it("cuts one oversized turn into windows that fit the byte budget, at the tail and around an item", async () => {
		const { page: tail } = await pl.api<OpenThread>(
			`/investigations/${big}/window`,
		);
		expect(tail.hasBefore).toBe(true);
		expect(JSON.stringify(tail.items).length).toBeLessThanOrEqual(192 * 1024);
		expect(tail.hi).toBe(`main:${BIG}`);
		const around = await pl.api<ThreadPage>(
			`/investigations/${big}/window/page?gen=0&around=main:150`,
		);
		expect(around.target).toBe("main:150");
		expect(around.items.map((i) => i.key)).toContain("main:150");
		expect(around).toMatchObject({ hasBefore: true, hasAfter: true });
		const turn = await pl.api<ThreadPage>(
			`/investigations/${big}/window/page?gen=0&turn=main:0`,
		);
		expect(turn.lo).toBe("main:0");
		expect(turn.hasAfter).toBe(true);
	});

	it("scans every row for a query JSON escapes, answers a repeat from its cache, and holds a revision", async () => {
		const q = encodeURIComponent('"everywhere"');
		const first = await pl.api<SearchEvents>(`/investigations/${big}/search?q=${q}`);
		expect(first).toMatchObject({ total: 1, items: 1, hits: [["main:0", 1]] });
		const again = await pl.api<SearchEvents>(`/investigations/${big}/search?q=${q}`);
		expect(again).toEqual(first);
		const held = await pl.api<SearchEvents>(
			`/investigations/${big}/search?q=row%2012&revision=50`,
		);
		// Only rows up to ordinal 50 count: "row 12" matches row 12, and no row 120-129 yet.
		expect(held).toMatchObject({ revision: 50, total: 1 });
	});

	it("walks threads in pages, handing back where to go on", async () => {
		const first = await pl.api<SearchMessages>(
			"/threads/search-messages?q=needle&limit=1",
		);
		expect(first.hits).toHaveLength(1);
		expect(first.next).not.toBeNull();
		const rest = await pl.api<SearchMessages>(
			`/threads/search-messages?q=needle&limit=5&cursor=${first.next}`,
		);
		expect(
			[...first.hits, ...rest.hits].map((h) => h.threadId).sort(),
		).toEqual([thread, other].sort());
	});
});

describe("Rail marks for recorded provider stops on SQLite (#1101 categories 14 and 17)", () => {
	it("a seeded usage limit, API-key failure and restart each produce a mark with its detail", async () => {
		const prisma = await pl.prisma();
		const id = (
			await prisma.investigation.create({
				data: { kind: "chat", status: "failed", title: "Stopped thread" },
			})
		).id;
		await insert(id, [
			{
				kind: "operator_message",
				...base(0),
				text: "Look at the pool",
				mode: "queue",
				delivered: true,
			},
			{
				kind: "usage_limit",
				...base(1),
				agent: "claude-code",
				text: "You've hit your limit",
				resetsAt: at(5000),
				mode: "usage_limit",
				window: "session",
			},
			{
				kind: "provider_blocked",
				...base(2),
				agent: "codex",
				mode: "key_rejected",
				text: "The API key was rejected",
			},
			{ kind: "run_interrupted", ...base(3), reason: "restart" },
		]);
		const index = await pl.api<ThreadIndex>(`/investigations/${id}/window/index`);
		expect(
			index.entries.filter((e) => e[2]).map((e) => [e[0], e[2], e[5]]),
		).toEqual([
			["main:1", "usage_limit", at(5000)],
			["main:2", "auth", "key_rejected"],
			["main:3", "restart", null],
		]);
	});
});
