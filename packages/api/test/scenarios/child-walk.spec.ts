// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, ThreadLinks } from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

/** Walk 6 of #1101, as `scripts/fakes/sessions/child-walk.json` plays it. */
const pl = new ScenarioApp({ mcp: true });
let root = "";
const REPORT =
	"The pool is exhausted: the new deploy doubled the api's retries, and each retry holds a connection.";

async function eventsOf(id: string): Promise<CanonicalEvent[]> {
	const rows = await (await pl.prisma()).investigationEvent.findMany({
		where: { investigationId: id },
		orderBy: [{ seq: "asc" }, { branchId: "asc" }],
	});
	return rows.map((r) => JSON.parse(r.event) as CanonicalEvent);
}

beforeAll(async () => {
	await pl.boot();
	const value = JSON.stringify({ agentsStartThreads: "allow", children: 4, perTree: 10 });
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
	// The starter ends its turn, then reopens when the started thread reports back.
	await eventually(
		async () => (await eventsOf(root)).flatMap((e) => (e.kind === "operator_message" ? [e.text] : [])),
		(t) => t.some((x) => x.includes(REPORT)),
		"the report to reopen the starter",
		90_000,
	);
}, 120_000);

afterAll(async () => {
	await pl.dispose();
});

describe("Walk 6: watch an agent start a thread that reports back by message (#1101 cat 10)", () => {
	it("Then the starter records Started thread X, and the started thread is marked with who started it", async () => {
		const links = await pl.api<ThreadLinks>(`/threads/${root}/links`);
		const [db] = links.started;
		expect(links.startedBy).toBeNull();
		expect(links.started.map((l) => [l.title, l.link])).toEqual([["Check the database pool", `/threads/${db?.id}`]]);
		expect((await pl.api<ThreadLinks>(`/threads/${db?.id}/links`)).startedBy).toMatchObject({ id: root, via: "agent" });
		expect((await eventsOf(root)).find((e) => e.kind === "thread_started")).toMatchObject({
			childId: db?.id,
			title: "Check the database pool",
		});
	});

	it("Then the report is a plain message from the started thread, recorded on both, and nothing else is sent back", async () => {
		const links = await pl.api<ThreadLinks>(`/threads/${root}/links`);
		const db = links.started[0]?.id as string;
		const messages = await (await pl.prisma()).threadMessage.findMany({ where: { OR: [{ toId: root }, { fromId: root }] } });
		expect(messages.map((m) => [m.fromId, m.toId, m.type, m.text, m.state])).toEqual([[db, root, "message", REPORT, "delivered"]]);
		expect((await eventsOf(db)).find((e) => e.kind === "thread_message")).toMatchObject({ direction: "sent", peerTitle: expect.any(String), text: REPORT });
		expect((await eventsOf(root)).find((e) => e.kind === "thread_message")).toMatchObject({ direction: "received", peerTitle: "Check the database pool", text: REPORT });
		const heard = (await eventsOf(root)).flatMap((e) => (e.kind === "operator_message" ? [e.text] : []));
		expect(heard.find((x) => x.includes(REPORT))).toContain(`[Message from Check the database pool (/threads/${db})] ${REPORT}`);
		// The started thread's finish sends nothing on its own.
		expect(heard.filter((x) => x.includes("finished:"))).toEqual([]);
	});
});
