// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIMIT_RESET_NOTE } from "../../src/modules/wakes/session.js";
import { eventually, type Investigation, ScenarioApp } from "./support/scenario-app.js";

// A recorded-agent limit case beside provider-stops.spec.ts: its parent starts threads, so the fake takes the gateway.
const pl = new ScenarioApp({ mcp: true });

beforeAll(async () => {
	await pl.boot();
}, 60_000);

afterAll(async () => {
	await pl.dispose();
});

type Event = { kind: string; [k: string]: unknown };
type Session = { limit?: { mode?: string; nextAttemptAt?: string } };

const finished = (i: Investigation) => !["pending", "running"].includes(i.status);

async function startThread(sessionName: string, text: string): Promise<string> {
	const res = await pl.api<{ investigationId: string }>("/threads", {
		method: "POST",
		body: { subject: { kind: "none" }, text: `${text} fake-session:${sessionName}` },
	});
	return res.investigationId;
}

const waitForStop = (id: string, timeoutMs: number) =>
	eventually(() => pl.investigation(id), finished, "the run to stop", timeoutMs);
const events = async (id: string) =>
	(await pl.api<{ events: Event[] }>(`/investigations/${id}/events?limit=200`)).events;
/** Imported once the app runs: its module reads the config, which must see the scenario workspace first. */
async function treeService() {
	const { ThreadTreeService } = await import("../../src/modules/thread-tree/thread-tree.service.js");
	const service = pl.resolve<InstanceType<typeof ThreadTreeService>>(ThreadTreeService);
	if (!service) throw new Error("ThreadTreeService did not resolve");
	return service;
}
const session = async (id: string) =>
	(await pl.api<{ session: Session }>(`/investigations/${id}`)).session;

describe("A usage limit while child reports arrive (#1101 category 17 item 9)", () => {
	type Inbound = {
		kind: "message_inbound";
		messageId: string;
		source: string;
		state: string;
		arrivedAt: string;
		from?: { name: string };
		failure?: { mode: string };
		line: string;
	};
	const inbound = async (id: string) =>
		(await events(id)).filter((e): e is Event & Inbound => e.kind === "message_inbound");
	const said = async (id: string) =>
		(await events(id)).flatMap((e) =>
			e.kind === "operator_message" && e.delivered === true ? [e.text as string] : [],
		);

	it.each([{ restart: false }, { restart: true }])(
		"limit-with-child-reports (restart: $restart): three reports wait while Limited, then reach the parent once each, in order, on resume",
		async ({ restart }) => {
			// ce798d662 makes turnsPerDay a required tree setting.
			const treeSettings = { agentsStartThreads: "allow", depth: 2, children: 4, perTree: 10, turnsPerDay: 200 };
			const put = await pl.fetchAs("PUT", "/threads/tree-settings", treeSettings);
			expect([put.status, await put.json()]).toEqual([200, treeSettings]);
			const id = await startThread("limit-with-child-reports", "Why is the pool exhausted?");
			expect(await waitForStop(id, 60_000)).toMatchObject({ status: "failed", endReason: "limited" });

			// The children answer 4, 7 and 10 s in, after the limit: each report is recorded waiting on it.
			const waiting = await eventually(
				() => inbound(id),
				(w) => w.filter((e) => e.state === "waiting").length === 3,
				"three reports recorded waiting",
				60_000,
			);
			expect(waiting.map((e) => [e.source, e.state, e.failure?.mode, e.from?.name, e.line])).toEqual(
				["db", "api", "cache"].map((name) => [
					"child",
					"waiting",
					"usage_limit",
					name,
					"Waiting: OpenCode reached its session limit",
				]),
			);
			const arrived = waiting.map((e) => Date.parse(e.arrivedAt));
			expect([...arrived].sort((a, b) => a - b)).toEqual(arrived);

			// Tree passes that would reopen a waiting parent leave a Limited one as it is.
			const tree = await treeService();
			await tree.tick();
			await tree.tick();
			const queued = async () =>
				(await pl.prisma()).threadMessage.findMany({ where: { toId: id }, orderBy: { createdAt: "asc" } });
			expect((await queued()).map((m) => [m.id, m.state])).toEqual(waiting.map((e) => [e.messageId, "queued"]));
			expect(await pl.investigation(id)).toMatchObject({ status: "failed", endReason: "limited" });
			expect((await events(id)).filter((e) => e.kind === "resumed")).toHaveLength(0);
			expect((await said(id)).filter((t) => t.includes("] result: "))).toEqual([]);
			expect((await session(id)).limit).toMatchObject({ mode: "usage_limit" });

			if (restart) {
				await pl.stop();
				await pl.boot();
				expect(await pl.investigation(id)).toMatchObject({ status: "failed", endReason: "limited" });
				expect((await queued()).map((m) => m.state)).toEqual(["queued", "queued", "queued"]);
			}

			const ses = await session(id);
			const resumeAt = new Date(Date.parse(ses.limit?.nextAttemptAt as string) + 60_000);
			const sessions = await pl.sessions();
			await sessions.process(resumeAt);
			await sessions.process(resumeAt);
			await eventually(() => pl.investigation(id), (i) => i.status === "completed", "the resumed parent to finish", 60_000);

			const all = await events(id);
			expect(all.filter((e) => e.kind === "resumed")).toHaveLength(1);
			expect(all.filter((e) => e.kind === "usage_limit")).toHaveLength(1);
			// One resume line carries the three reports, oldest first; no report reaches the agent twice.
			const lines = (await said(id)).filter((t) => t.includes("] result: "));
			expect(lines).toHaveLength(1);
			const order = ["db #2", "api #3", "cache #4"].map((who) => lines[0]?.indexOf(`[FROM ${who}] result: `));
			expect(order.every((i) => (i ?? -1) > 0)).toBe(true);
			expect([...order].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(order);
			expect(lines[0]?.startsWith(LIMIT_RESET_NOTE)).toBe(true);
			const delivered = (await inbound(id)).filter((e) => e.state === "delivered");
			expect(delivered.map((e) => e.messageId)).toEqual(waiting.map((e) => e.messageId));
			expect(delivered.map((e) => e.line)).toEqual(["Delivered", "Delivered", "Delivered"]);
			expect((await queued()).map((m) => m.state)).toEqual(["delivered", "delivered", "delivered"]);
			// Later passes deliver nothing again.
			const liveTree = await treeService();
			await liveTree.tick();
			await liveTree.tick();
			expect((await said(id)).filter((t) => t.includes("] result: "))).toHaveLength(1);
		},
		180_000,
	);
});
