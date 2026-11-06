// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, ThreadTree } from "@prismalens/contracts";
import {
	executeTool,
	resolveCall,
	resultValue,
	runView,
	servedTo,
} from "@prismalens/integrations/harness";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASKS_PORT } from "../../src/modules/asks/asks.contract.js";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp({ mcp: true });
const finished = (s: string) => ["completed", "failed", "cancelled"].includes(s);

async function eventsOf(id: string): Promise<CanonicalEvent[]> {
	const rows = await (await pl.prisma()).investigationEvent.findMany({
		where: { investigationId: id },
		orderBy: [{ seq: "asc" }, { branchId: "asc" }],
	});
	return rows.map((r) => JSON.parse(r.event) as CanonicalEvent);
}

async function setTree(agentsStartThreads: "ask" | "allow" | "never") {
	const value = JSON.stringify({ agentsStartThreads, depth: 2, children: 4, perTree: 10 });
	await (await pl.prisma()).setting.upsert({
		where: { key: "threads.tree" },
		create: { key: "threads.tree", value },
		update: { value },
	});
}

let root = "";

beforeAll(async () => {
	await pl.boot();
	await setTree("allow");
	const started = await pl.api<{ investigationId: string }>("/threads", {
		method: "POST",
		body: { subject: { kind: "none" }, text: "fake-session:tree-parent Why is the db pool exhausted?" },
	});
	root = started.investigationId;
	// Both children finish, and the parent is reopened for their results.
	await eventually(
		() => pl.api<ThreadTree>(`/threads/${root}/tree`),
		(t) => t.nodes.length === 3 && t.nodes.slice(1).every((n) => n.state !== "queued" && n.state !== "running"),
		"both children to finish",
		90_000,
	);
}, 120_000);

afterAll(async () => {
	await pl.dispose();
});

describe("Threads that start threads (#1024 spec F)", () => {
	it("Given a parent that starts two children, Then the panel's tree shows the root, both children and their links", async () => {
		const tree = await pl.api<ThreadTree>(`/threads/${root}/tree`);
		expect(tree.rootId).toBe(root);
		expect(tree.nodes.map((n) => [n.number, n.role, n.depth])).toEqual([
			[1, null, 0],
			[2, "db", 1],
			[3, "api", 1],
		]);
		for (const n of tree.nodes) expect(n.link).toBe(`/threads/${n.id}`);
		expect(tree.nodes.slice(1).map((n) => n.state)).toEqual(["answered", "answered"]);
	});

	it("Then the parent's transcript shows each start and each finish", async () => {
		const kinds = (await eventsOf(root)).map((e) => e.kind);
		expect(kinds.filter((k) => k === "thread_started")).toHaveLength(2);
		await eventually(
			async () => (await eventsOf(root)).filter((e) => e.kind === "child_finished").length,
			(n) => n === 2,
			"both finishes on the parent",
			30_000,
		);
	}, 60_000);

	it("Then the parent, which waited on both, is reopened for their results", async () => {
		const texts = await eventually(
			async () =>
				(await eventsOf(root)).flatMap((e) => (e.kind === "operator_message" ? [e.text] : [])),
			(t) => t.filter((x) => x.includes("result:")).length >= 1,
			"a result delivered to the parent",
			60_000,
		);
		expect(texts.some((t) => /\[FROM (db #2|api #3)\] result: \/threads\/.+ finished: answered\./.test(t))).toBe(true);
	}, 90_000);

	it("Then each child's message to its peer is recorded on the sender's side and queued or delivered to the receiver", async () => {
		const tree = await pl.api<ThreadTree>(`/threads/${root}/tree`);
		const [, db, api] = tree.nodes;
		const sent = (await eventsOf(api?.id as string)).find((e) => e.kind === "thread_message");
		expect(sent).toMatchObject({ direction: "sent", peerRole: "db", type: "fact" });
		const messages = await (await pl.prisma()).threadMessage.findMany({ where: { rootId: root, type: "fact" } });
		expect(messages.map((m) => [m.fromId, m.toId]).sort()).toEqual(
			[
				[db?.id, root],
				[api?.id, db?.id],
				// The parent's note to db that api joined.
				[root, db?.id],
			].sort(),
		);
	});

	it("Then the children inherit the parent's no-subject, and a child's tools see its tree", async () => {
		const tree = await pl.api<ThreadTree>(`/threads/${root}/tree`);
		const child = tree.nodes[1]?.id as string;
		const row = await (await pl.prisma()).investigation.findUniqueOrThrow({ where: { id: child } });
		expect(row).toMatchObject({ parentId: root, rootId: root, depth: 1, repositoryId: null, serviceId: null, incidentId: null });
		const g = await pl.gateway();
		// The read tools also work through search: thread_roster is found and run by tools_call.
		const view = runView(servedTo(g.tools, { subject: "none", owes: "answer", tree: true }), { search: true });
		expect(view.deferred.map((t) => t.name)).toEqual(expect.arrayContaining(["thread_roster", "thread_read"]));
		// thread_wait goes with thread_start, so it is always listed; tools_call still runs it.
		expect(view.direct.map((t) => t.name)).toContain("thread_wait");
		expect(resolveCall(view, "tools_call", { name: "thread_wait", arguments: { ids: ["x"] } })?.tool.name).toBe("thread_wait");
		const ctx = { runId: child, signal: new AbortController().signal };
		const search = view.direct.find((t) => t.name === "tools_search");
		const found = resultValue((await executeTool(search as never, { query: "tree roster" }, ctx)).output);
		expect(found.tools.map((t: { name: string }) => t.name)).toContain("thread_roster");
		const call = resolveCall(view, "tools_call", { name: "thread_roster", arguments: {} });
		expect(call?.tool.name).toBe("thread_roster");
		const roster = resultValue((await executeTool(call?.tool as never, call?.args, ctx)).output);
		expect(roster.members.map((m: { relation: string }) => m.relation)).toEqual(["parent", "you", "sibling"]);
		// An act tool is never reached through search.
		expect(resolveCall(view, "tools_call", { name: "thread_start", arguments: {} })?.tool.name).toBe("tools_call");
	});

	it("Then a member reads a sibling's steps page by page, though the sibling has no subject", async () => {
		const tree = await pl.api<ThreadTree>(`/threads/${root}/tree`);
		const [, db, api] = tree.nodes;
		const g = await pl.gateway();
		const read = g.tools.find((t) => t.name === "thread_read");
		const r = (await read?.run(read.input.parse({ threadId: db?.id, afterSeq: -1, limit: 5 }), {
			runId: api?.id as string,
			signal: new AbortController().signal,
		})) as { value: { page: { steps: { text: string }[] } } };
		expect(r.value.page.steps.map((s) => s.text).join("")).toContain("The pool is exhausted");
	});

	it("Given Never, Then a new run's view offers no act tools", async () => {
		await setTree("never");
		const g = await pl.gateway();
		const lease = await g.lease(root, "prismalens-tree", undefined, undefined, { subject: "none", owes: "answer" });
		expect(lease?.tools).not.toContain("thread_start");
		expect(lease?.tools).not.toContain("thread_send");
		expect(lease?.tools).toContain("thread_roster");
		g.revoke(root);
		await setTree("allow");
	});

	it("Given Ask each time, Then a start's host-only card outlives the caller's turn, and a later approval starts the child and reopens the caller", async () => {
		expect(pl.resolve(ASKS_PORT)).toBeDefined();
		await setTree("ask");
		const hold = `tree-ask-${randomUUID()}`;
		const { investigationId: asker } = await pl.api<{ investigationId: string }>("/threads", {
			method: "POST",
			body: { subject: { kind: "none" }, text: `fake-session:tree-ask ${hold}` },
		});
		const db = await pl.prisma();
		const action = await eventually(
			() => db.pendingAction.findFirst({ where: { callerId: asker } }),
			(a) => !!a?.askId,
			"the start's card to open",
			60_000,
		);
		expect(action?.state).toBe("pending");
		// The caller's turn ends with the card still open.
		await eventually(
			() => pl.api<{ status: string }>(`/investigations/${asker}`),
			(i) => finished(i.status),
			"the caller's turn to end",
			60_000,
		);
		expect((await db.pendingAction.findUniqueOrThrow({ where: { id: action?.id } })).state).toBe("pending");
		const opened = await eventually(
			async () => (await eventsOf(asker)).find((e) => e.kind === "ask_opened"),
			(e) => !!e,
			"the card recorded on the caller",
			30_000,
		);
		expect(opened).toMatchObject({ ask: { requiresHost: true, source: { kind: "tool", tool: "thread_start", requestId: "ask-cache" } } });
		await pl.api(`/investigations/${asker}/asks/${action?.askId}`, {
			method: "POST",
			body: { askId: action?.askId, answer: { kind: "permission", decision: "approve" } },
		});
		const done = await eventually(
			() => db.pendingAction.findFirstOrThrow({ where: { id: action?.id } }),
			(a) => a.state === "done",
			"the approved start to run",
			30_000,
		);
		const child = JSON.parse(done.result as string).childId as string;
		expect((await db.investigation.findUniqueOrThrow({ where: { id: child } })).parentId).toBe(asker);
		// The ended caller is reopened with the outcome.
		await eventually(
			async () =>
				(await eventsOf(asker)).flatMap((e) => (e.kind === "operator_message" ? [e.text] : [])),
			(t) => t.some((x) => x.includes('thread_start call (requestId "ask-cache") was approved')),
			"the outcome delivered to the reopened caller",
			60_000,
		);
		await setTree("allow");
	}, 120_000);
});
