// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, ThreadTree } from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

/** Walk 6 of #1101, as `scripts/fakes/sessions/child-walk.json` plays it. */
const pl = new ScenarioApp({ mcp: true });
let root = "";

async function eventsOf(id: string): Promise<CanonicalEvent[]> {
	const rows = await (await pl.prisma()).investigationEvent.findMany({
		where: { investigationId: id },
		orderBy: [{ seq: "asc" }, { branchId: "asc" }],
	});
	return rows.map((r) => JSON.parse(r.event) as CanonicalEvent);
}

beforeAll(async () => {
	await pl.boot();
	const value = JSON.stringify({ agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10 });
	await (await pl.prisma()).setting.upsert({
		where: { key: "threads.tree" },
		create: { key: "threads.tree", value },
		update: { value },
	});
	root = (
		await pl.api<{ investigationId: string }>("/threads", {
			method: "POST",
			body: { subject: { kind: "none" }, text: "fake-session:child-walk Why do checkouts 502?" },
		})
	).investigationId;
	await eventually(
		() => eventsOf(root),
		(es) => es.some((e) => e.kind === "child_finished"),
		"the child to finish",
		90_000,
	);
}, 120_000);

afterAll(async () => {
	await pl.dispose();
});

describe("Walk 6: watch an agent start, message and finish a child thread (#1101)", () => {
	it("Then the parent records the start, its message to db, db's fact to it, db's finish with an excerpt, and db's result", async () => {
		const tree = await pl.api<ThreadTree>(`/threads/${root}/tree`);
		const db = tree.nodes.find((n) => n.role === "db");
		expect(db?.parentId).toBe(root);
		const events = await eventsOf(root);
		expect(events.find((e) => e.kind === "thread_started")).toMatchObject({ childId: db?.id, role: "db", title: "Check the database pool" });
		expect(events.find((e) => e.kind === "thread_message")).toMatchObject({ direction: "sent", peerRole: "db", type: "fact", text: "The 502s started at 13:58, right after the deploy." });
		expect(events.find((e) => e.kind === "child_finished")).toMatchObject({
			childId: db?.id,
			outcome: "answered",
			excerpt: expect.stringContaining("The pool is exhausted"),
		});
		const fact = await (await pl.prisma()).threadMessage.findFirst({ where: { rootId: root, fromId: db?.id, toId: root, type: "fact" } });
		expect(fact?.text).toBe("The pool has 10 connections and all are busy.");
		const heard = await eventually(
			async () => (await eventsOf(root)).flatMap((e) => (e.kind === "operator_message" ? [e.text] : [])),
			(t) => t.some((x) => x.startsWith("[FROM db #2] result:")),
			"db's result delivered to the parent",
			60_000,
		);
		expect(heard.find((x) => x.startsWith("[FROM db #2] result:"))).toContain("The pool is exhausted");
	}, 90_000);
});
