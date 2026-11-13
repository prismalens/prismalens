// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, ThreadLinks } from "@prismalens/contracts";
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

async function setTree(agentsStartThreads: "ask" | "allow" | "never", pairPerDay = 20) {
	const value = JSON.stringify({ agentsStartThreads, children: 4, perTree: 10, pairPerDay });
	await (await pl.prisma()).setting.upsert({
		where: { key: "threads.tree" },
		create: { key: "threads.tree", value },
		update: { value },
	});
}

const heard = async (id: string) =>
	(await eventsOf(id)).flatMap((e) => (e.kind === "operator_message" ? [e.text] : []));

let root = "";

beforeAll(async () => {
	await pl.boot();
	await setTree("allow");
	const started = await pl.api<{ investigationId: string }>("/threads", {
		method: "POST",
		body: { subject: { kind: "none" }, text: "fake-session:tree-parent Why is the db pool exhausted?" },
	});
	root = started.investigationId;
	// Both started threads report back, and the starter reopens for each message.
	await eventually(
		() => heard(root),
		(t) => t.filter((x) => x.includes("[Message from ")).length >= 2,
		"both reports to reach the starter",
		90_000,
	);
}, 120_000);

afterAll(async () => {
	await pl.dispose();
});

describe("Threads that start threads are siblings (#1101 cat 10)", () => {
	it("Given a thread that starts two, Then its links list both flat, and each names it as its starter", async () => {
		const links = await pl.api<ThreadLinks>(`/threads/${root}/links`);
		expect(links.chainId).toBe(root);
		expect(links.started.map((l) => l.title)).toEqual(["Check the database pool", "Check the api retries"]);
		for (const l of links.started) {
			expect(l.link).toBe(`/threads/${l.id}`);
			expect((await pl.api<ThreadLinks>(`/threads/${l.id}/links`)).startedBy).toMatchObject({ id: root, via: "agent" });
		}
	});

	it("Then the starter's transcript shows each start, and no finish is sent back by itself", async () => {
		const kinds = (await eventsOf(root)).map((e) => e.kind);
		expect(kinds.filter((k) => k === "thread_started")).toHaveLength(2);
		expect(await (await pl.prisma()).threadMessage.count({ where: { type: "result" } })).toBe(0);
	});

	it("Then the starter is reopened for each report, which names its sender and link", async () => {
		const links = await pl.api<ThreadLinks>(`/threads/${root}/links`);
		const texts = (await heard(root)).filter((x) => x.includes("[Message from "));
		for (const l of links.started)
			expect(texts.some((t) => t.includes(`[Message from ${l.title} (/threads/${l.id})] The pool has 10 connections and all are busy.`))).toBe(true);
	});

	it("Then each report is recorded on the sender's side with the starter's title", async () => {
		const links = await pl.api<ThreadLinks>(`/threads/${root}/links`);
		for (const l of links.started)
			expect((await eventsOf(l.id)).find((e) => e.kind === "thread_message")).toMatchObject({
				direction: "sent",
				peerLink: `/threads/${root}`,
				type: "message",
			});
		const messages = await (await pl.prisma()).threadMessage.findMany({ where: { toId: root } });
		expect(messages.map((m) => m.fromId).sort()).toEqual(links.started.map((l) => l.id).sort());
	});

	it("Then the started threads inherit the starter's no-subject, and a linked thread's tools reach its links", async () => {
		const links = await pl.api<ThreadLinks>(`/threads/${root}/links`);
		const child = links.started[0]?.id as string;
		const row = await (await pl.prisma()).investigation.findUniqueOrThrow({ where: { id: child } });
		expect(row).toMatchObject({ parentId: root, rootId: root, depth: 1, role: null, repositoryId: null, serviceId: null, incidentId: null });
		const g = await pl.gateway();
		const view = runView(servedTo(g.tools, { subject: "none", owes: "answer", tree: true }), { search: true });
		expect(view.direct.map((t) => t.name)).toEqual(expect.arrayContaining(["pl_thread_start", "pl_thread_send", "pl_thread_cancel"]));
		expect([...view.direct, ...view.deferred].map((t) => t.name)).not.toEqual(expect.arrayContaining(["pl_thread_wait"]));
		// pl_thread_list is found and run through search: `startedBy: me` lists the starter's two threads.
		const call = resolveCall(view, "pl_tools_call", { name: "pl_thread_list", arguments: { startedBy: "me" } });
		expect(call?.tool.name).toBe("pl_thread_list");
		const listed = resultValue((await executeTool(call?.tool as never, call?.args, { runId: root, signal: new AbortController().signal })).output);
		expect(listed.threads.map((t: { link: string }) => t.link).sort()).toEqual(links.started.map((l) => l.link).sort());
		const starter = resultValue((await executeTool(call?.tool as never, { startedBy: "starter", limit: 10 }, { runId: child, signal: new AbortController().signal })).output);
		expect(starter.threads.map((t: { id: string }) => t.id)).toEqual([root]);
		// An act tool is never reached through search.
		expect(resolveCall(view, "pl_tools_call", { name: "pl_thread_start", arguments: {} })?.tool.name).toBe("pl_tools_call");
	});

	it("Then the starter reads a started thread's steps page by page, though it has no subject", async () => {
		const links = await pl.api<ThreadLinks>(`/threads/${root}/links`);
		const g = await pl.gateway();
		const read = g.tools.find((t) => t.name === "pl_thread_read");
		const r = (await read?.run(read.input.parse({ threadId: links.started[0]?.id, afterSeq: -1, limit: 5 }), {
			runId: root,
			signal: new AbortController().signal,
		})) as { value: { page: { steps: { text: string }[] } } };
		expect(r.value.page.steps.map((s) => s.text).join("")).toContain("The pool is exhausted");
	});

	it("Given two threads messaging in a loop, Then the pair cap holds the rest unread, wakes nothing, and both show it", async () => {
		await setTree("allow", 4);
		const { investigationId: looper } = await pl.api<{ investigationId: string }>("/threads", {
			method: "POST",
			body: { subject: { kind: "none" }, text: "fake-session:message-loop Check the cache" },
		});
		const db = await pl.prisma();
		const peer = await eventually(
			() => db.investigation.findFirst({ where: { parentId: looper } }),
			(p) => !!p,
			"the peer to start",
			30_000,
		);
		const held = await eventually(
			() => db.threadMessage.findMany({ where: { state: "held", OR: [{ fromId: looper }, { fromId: peer?.id }] } }),
			(m) => m.length >= 1,
			"a message held at the pair cap",
			90_000,
		);
		expect(await db.threadMessage.count({ where: { state: { not: "held" }, OR: [{ fromId: looper }, { fromId: peer?.id }] } })).toBe(4);
		const [first] = held;
		const notice = (id: string) =>
			eventsOf(id).then((es) => es.filter((e) => e.kind === "thread_message" && e.held === true));
		expect((await notice(first?.fromId as string)).map((e) => (e as { direction: string }).direction)).toContain("sent");
		expect((await notice(first?.toId as string)).map((e) => (e as { direction: string }).direction)).toContain("received");
		// Nothing more is delivered once both have gone quiet.
		await eventually(
			async () => [(await pl.investigation(looper)).status, (await pl.investigation(peer?.id as string)).status],
			(s) => s.every(finished),
			"both to go quiet",
			60_000,
		);
		expect(await db.threadMessage.count({ where: { state: "delivered", OR: [{ fromId: looper }, { fromId: peer?.id }] } })).toBe(4);
		await setTree("allow");
	}, 150_000);

	it("Given Never, Then a new run's view offers no start, message or stop tools", async () => {
		await setTree("never");
		const g = await pl.gateway();
		const lease = await g.lease(root, "prismalens-tree", undefined, undefined, { subject: "none", owes: "answer" });
		expect(lease?.tools).not.toContain("pl_thread_start");
		expect(lease?.tools).not.toContain("pl_thread_send");
		expect(lease?.tools).not.toContain("pl_thread_cancel");
		expect(lease?.tools).toContain("pl_thread_read");
		g.revoke(root);
		await setTree("allow");
	});

	it("Given Ask each time, Then a start's host-only card outlives the caller's turn, and a later approval starts the thread and reopens the caller", async () => {
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
		expect(opened).toMatchObject({ ask: { requiresHost: true, source: { kind: "tool", tool: "pl_thread_start", requestId: "ask-cache" } } });
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
		const made = JSON.parse(done.result as string).id as string;
		expect((await db.investigation.findUniqueOrThrow({ where: { id: made } })).parentId).toBe(asker);
		// The ended caller is reopened with the outcome.
		await eventually(
			() => heard(asker),
			(t) => t.some((x) => x.includes('pl_thread_start call (requestId "ask-cache") was approved')),
			"the outcome delivered to the reopened caller",
			60_000,
		);
		await setTree("allow");
	}, 120_000);
});
