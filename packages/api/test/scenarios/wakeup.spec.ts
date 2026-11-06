// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FakeAlertmanager, startFakeAlertmanager } from "../../../../scripts/fakes/fake-alertmanager.mjs";
import { eventually, ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp({ mcp: true });
let am: FakeAlertmanager;

beforeAll(async () => {
	am = await startFakeAlertmanager();
	await pl.boot();
	await pl.api("/settings/harness", { method: "PATCH", body: { harness: "opencode" } });
}, 60_000);

afterAll(async () => {
	await am.close();
	await pl.dispose();
});

const events = async (id: string) =>
	(await pl.api<{ events: CanonicalEvent[] }>(`/investigations/${id}/events?limit=200`)).events;

describe("Walk: the agent wakes its own thread later (#1024 spec B)", () => {
	it("Given wakeup_schedule, When its time comes after the run ended, Then the thread resumes and the agent hears its own reason", async () => {
		await pl.serviceWithRepo("rollout");
		const alert = am.fire({
			labels: { alertname: "RolloutSlow fake-session:wakeup", service: "rollout", severity: "medium" },
			annotations: { summary: "rollout latency" },
		});
		await am.post(pl.webhookUrl, pl.webhookToken);
		const [incident] = await eventually(() => pl.incidentFor(alert.fingerprint), (f) => f.length === 1, "an incident");
		if (!incident) throw new Error("no incident");
		await pl.api(`/incidents/${incident.id}/investigate`, { method: "POST", body: { accessLevel: "supervised" } });
		const [run] = await eventually(() => pl.investigations(incident.id), (r) => r.length === 1, "the run");
		if (!run) throw new Error("no run");
		await eventually(async () => (await pl.investigation(run.id)).status, (s) => s === "completed", "the first turn ends", 60_000);

		const scheduled = (await events(run.id)).find((e) => e.kind === "wake_scheduled");
		expect(scheduled).toMatchObject({ wakeKind: "agent", reason: "Check the rollout of revision 42" });
		const db = await pl.prisma();
		const [wake] = await db.threadWake.findMany({ where: { investigationId: run.id, kind: "agent", state: "pending" } });
		expect(wake?.at.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
		// Its time comes: the lifecycle pass takes the thread up again.
		await db.threadWake.update({ where: { id: wake?.id ?? "" }, data: { at: new Date(Date.now() - 1000) } });
		await (await pl.sessions()).process();
		await pl.tick();
		const said = await eventually(
			async () => (await events(run.id)).flatMap((e) => (e.kind === "agent_step" ? [e.text] : [])).join(""),
			(t) => t.includes("Heard:"),
			"the agent hears the wake",
			60_000,
		);
		expect(said).toContain("Heard: The wake you scheduled (wakeup_schedule) is due: Check the rollout of revision 42");
	}, 180_000);
});
