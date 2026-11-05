// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type FakeAlertmanager,
	startFakeAlertmanager,
} from "../../../../scripts/fakes/fake-alertmanager.mjs";
import { eventually, type Investigation, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();
let am: FakeAlertmanager;

beforeAll(async () => {
	am = await startFakeAlertmanager();
	await pl.boot();
	await pl.serviceWithRepo("books");
	await pl.api("/settings/harness", { method: "PATCH", body: { harness: "claude-code" } });
}, 60_000);
afterAll(async () => {
	await am.close();
	await pl.dispose();
});

type Event = { kind: string; [k: string]: unknown };
type Thread = Investigation & {
	acpSessionId?: string | null;
	session: { cache: string; contextTokens?: number; compaction: string; compactCommand?: string; lastActivityAt: string };
};

const thread = (id: string) => pl.api<Thread>(`/investigations/${id}`);
const events = async (id: string) =>
	(await pl.api<{ events: Event[] }>(`/investigations/${id}/events?limit=200`)).events;
const idle = (i: Investigation) => !["pending", "running"].includes(i.status);

describe("A long-idle session picks up cheaply (#1024)", () => {
	let id = "";

	it("Given a finished thread idle three hours with a large context, Then its cache reads unknown, never a guess, and it offers the agent's compact command", async () => {
		const alert = am.fire({
			labels: { alertname: "BooksSlow fake-session:compact", service: "books", severity: "critical" },
			annotations: { summary: "p99 of GET /books above 2s" },
		});
		expect((await am.post(pl.webhookUrl, pl.webhookToken)).status).toBeLessThan(300);
		const [incident] = await eventually(() => pl.incidentFor(alert.fingerprint), (f) => f.length === 1, "the incident");
		const [run] = await eventually(() => pl.investigations(incident?.id as string), (r) => r.length === 1, "the run");
		id = run?.id as string;
		const done = await eventually(() => pl.investigation(id), idle, "the run to finish", 30_000);
		expect(done.status).toBe("completed");

		const prisma = await pl.prisma();
		await prisma.investigation.update({
			where: { id },
			data: { lastActivityAt: new Date(Date.now() - 3 * 60 * 60_000) },
		});
		const t = await thread(id);
		expect(t.session).toMatchObject({ cache: "unknown", contextTokens: 142_000, compaction: "none", compactCommand: "compact" });
	}, 60_000);

	it("When the user chooses Compact, then send, Then the boundary shows the counts before and after, then the message", async () => {
		const sent = await pl.api<{ state: string }>(`/investigations/${id}/messages`, {
			method: "POST",
			body: { text: "Still slow?", compact: true },
		});
		expect(sent.state).toBe("resumed");
		await eventually(() => pl.investigation(id), (i) => i.status === "completed", "the follow-up", 30_000);
		const all = await events(id);
		const start = all.findIndex((e) => e.kind === "compaction" && e.phase === "started");
		const end = all.findIndex((e) => e.kind === "compaction" && e.phase === "completed");
		const said = all.findIndex((e) => e.kind === "operator_message" && e.text === "Still slow?");
		expect(start).toBeGreaterThan(-1);
		expect(start).toBeLessThan(end);
		expect(end).toBeLessThan(said);
		expect(all[end]).toMatchObject({ method: "agent_command", before: 142_000, after: 18_000 });
		expect(JSON.stringify(all.slice(said))).toContain("Heard after compaction: Still slow?");
		expect((await thread(id)).session.compaction).toBe("agent_command");
	}, 60_000);

	it("When the user compacts on its own, Then only the compaction runs, with the instructions", async () => {
		await pl.api(`/investigations/${id}/compact`, { method: "POST", body: { instructions: "keep the index finding" } });
		await eventually(() => pl.investigation(id), (i) => i.status === "completed", "the compaction", 30_000);
		const all = await events(id);
		const last = all.filter((e) => e.kind === "compaction").at(-2);
		expect(last).toMatchObject({ phase: "started", instructions: "keep the index finding" });
		expect(all.filter((e) => e.kind === "operator_message").at(-1)?.text).toBe("Still slow?");
	}, 60_000);

	it("When the user chooses Start fresh with a summary, Then a new session starts in the same workspace, seeded from the record", async () => {
		const before = (await thread(id)).acpSessionId;
		await pl.api(`/investigations/${id}/messages`, { method: "POST", body: { text: "Take a fresh look.", fresh: true } });
		await eventually(() => pl.investigation(id), idle, "the fresh session's answer", 30_000);
		const message = (await events(id)).filter((e) => e.kind === "operator_message").at(-1) as
			| { text: string; via?: { handoff?: { carried: string } } }
			| undefined;
		expect(message?.text).toBe("Take a fresh look.");
		expect(message?.via?.handoff?.carried).toContain("the report");
		expect((await thread(id)).acpSessionId).not.toBe(before);
	}, 60_000);
});
