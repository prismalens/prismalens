// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type FakeAlertmanager,
	startFakeAlertmanager,
} from "../../../../scripts/fakes/fake-alertmanager.mjs";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();
let am: FakeAlertmanager;

beforeAll(async () => {
	am = await startFakeAlertmanager();
	await pl.boot();
}, 60_000);

afterAll(async () => {
	await am.close();
	await pl.dispose();
});

type Subagent = Extract<CanonicalEvent, { kind: "subagent" }>;

async function events(runId: string): Promise<CanonicalEvent[]> {
	const page = await pl.api<{ events: CanonicalEvent[] }>(
		`/investigations/${runId}/events?limit=200`,
	);
	return page.events;
}

const cancel = (runId: string, sessionId: string) =>
	pl.fetchAs("POST", `/investigations/${runId}/subagents/${sessionId}/cancel`, {});

/** The run a person starts on a fresh alert, so its asks wait for them. */
async function startRun(service: string, session: string): Promise<string> {
	await pl.serviceWithRepo(service);
	const alert = am.fire({
		labels: {
			alertname: `${service}Slow fake-session:${session}`,
			service,
			severity: "medium",
		},
		annotations: { summary: `${service} latency` },
	});
	await am.post(pl.webhookUrl, pl.webhookToken);
	const [incident] = await eventually(
		() => pl.incidentFor(alert.fingerprint),
		(found) => found.length === 1,
		"an incident carrying the alert",
	);
	if (!incident) throw new Error("no incident");
	await pl.api(`/incidents/${incident.id}/investigate`, {
		method: "POST",
		body: { accessLevel: "supervised" },
	});
	const [run] = await eventually(
		() => pl.investigations(incident.id),
		(runs) => runs.length === 1,
		"the run started",
	);
	if (!run) throw new Error("no run");
	return run.id;
}

describe("Walk: the user answers a sub-agent's ask and stops it where its agent allows (#1025)", () => {
	it("Given a run whose agent starts two sub-agents, When the user answers one's ask and stops it, Then the granted stop reaches it, the refused one is turned away, and the rows say how each ended", async () => {
		const runId = await startRun("shelves", "subagents");

		const ask = await eventually(
			async () => (await events(runId)).find((e) => e.kind === "permission_ask"),
			(e) => Boolean(e),
			"the sub-agent's ask",
			30_000,
		);
		if (ask?.kind !== "permission_ask") throw new Error("no ask");
		expect(ask.source).toEqual({
			kind: "subagent",
			sessionId: "sub-deploys",
			title: "Check deploys",
		});
		await pl.api(`/investigations/${runId}/asks/${ask.askId}`, {
			method: "POST",
			body: { answer: { kind: "permission", decision: "approve" } },
		});

		// Not started yet: nothing to stop.
		expect((await cancel(runId, "sub-metrics")).status).toBe(409);

		await eventually(
			async () => (await (await pl.prisma()).subagentSession.findMany({ where: { investigationId: runId } })),
			(rows) => rows.some((r) => r.sessionId === "sub-deploys" && r.state === "running"),
			"the sub-agent's row",
			30_000,
		);
		const stopped = await cancel(runId, "sub-deploys");
		expect(stopped.status).toBe(200);
		expect(await stopped.json()).toEqual({ state: "cancelling" });

		await eventually(
			async () => (await (await pl.prisma()).subagentSession.findMany({ where: { investigationId: runId } })),
			(rows) => rows.some((r) => r.sessionId === "sub-metrics"),
			"the second sub-agent's row",
			30_000,
		);
		const refused = await cancel(runId, "sub-metrics");
		expect(refused.status).toBe(403);
		expect(JSON.stringify(await refused.json())).toContain("does not let PrismaLens stop");

		const all = await eventually(
			() => events(runId),
			(evs) => evs.some((e) => e.kind === "report"),
			"the run's report",
			60_000,
		);
		const ends = Object.fromEntries(
			all
				.filter((e): e is Subagent => e.kind === "subagent" && !!e.state && e.phase === "state")
				.map((e) => [e.sessionId, e.state]),
		);
		expect(ends).toEqual({ "sub-deploys": "cancelled", "sub-metrics": "completed" });
		const rows = await (await pl.prisma()).subagentSession.findMany({
			where: { investigationId: runId },
			orderBy: { startedAt: "asc" },
		});
		expect(rows.map((r) => [r.sessionId, r.state, r.canCancel, !!r.endedAt])).toEqual([
			["sub-deploys", "cancelled", true, true],
			["sub-metrics", "completed", false, true],
		]);
		expect(rows[0]?.task).toBe("Read the last deploys of the books service");

		// A finished run's sub-agents cannot be stopped again.
		expect((await cancel(runId, "sub-deploys")).status).toBe(409);
	}, 120_000);
});
