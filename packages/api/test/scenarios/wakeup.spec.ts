// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FakeAlertmanager, startFakeAlertmanager } from "../../../../scripts/fakes/fake-alertmanager.mjs";
import type { ThreadLifecycleService } from "../../src/modules/threads/thread-lifecycle.service.js";
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

	it("Given a thread with its agent's wake pending, When the user settles it, Then the wake waits out Undo's window and is then cancelled; and a wake left on a settled or stopped thread never takes it up again", async () => {
		await pl.serviceWithRepo("settled");
		const alert = am.fire({
			labels: { alertname: "SettledSlow fake-session:wakeup", service: "settled", severity: "medium" },
			annotations: { summary: "settled latency" },
		});
		await am.post(pl.webhookUrl, pl.webhookToken);
		const [incident] = await eventually(() => pl.incidentFor(alert.fingerprint), (f) => f.length === 1, "an incident");
		if (!incident) throw new Error("no incident");
		await pl.api(`/incidents/${incident.id}/investigate`, { method: "POST", body: { accessLevel: "supervised" } });
		const [run] = await eventually(() => pl.investigations(incident.id), (r) => r.length === 1, "the run");
		if (!run) throw new Error("no run");
		await eventually(async () => (await pl.investigation(run.id)).status, (s) => s === "completed", "the first turn ends", 60_000);
		const db = await pl.prisma();
		const pending = () => db.threadWake.findMany({ where: { investigationId: run.id, kind: "agent", state: "pending" } });
		expect(await pending()).toHaveLength(1);

		const settled = (await pl.api(`/threads/${run.id}/settle`, { method: "POST", body: { settled: true } })) as {
			undoUntil: string;
		};
		// Inside Undo's window the wake stays; the teardown after it ends it (#1024 surface F).
		expect(await pending()).toHaveLength(1);
		const { ThreadLifecycleService: Lifecycle } = await import("../../src/modules/threads/thread-lifecycle.service.js");
		const lifecycle = pl.resolve<ThreadLifecycleService>(Lifecycle);
		if (!lifecycle) throw new Error("no lifecycle service");
		await lifecycle.teardownDue(new Date(Date.parse(settled.undoUntil) + 1));
		expect(await pending()).toEqual([]);

		// A wake that slipped past is ended at fire time, for a settled thread and for a stopped one.
		for (const status of ["completed", "cancelled"]) {
			await db.investigation.update({
				where: { id: run.id },
				data: { status, ...(status === "cancelled" ? { settledAt: null } : {}) },
			});
			const wake = await db.threadWake.create({
				data: { investigationId: run.id, kind: "agent", at: new Date(Date.now() - 1000), reason: "stale", payload: "{}" },
			});
			const before = (await events(run.id)).length;
			await (await pl.sessions()).process();
			await pl.tick();
			expect((await db.threadWake.findUnique({ where: { id: wake.id } }))?.state).toBe("cancelled");
			expect((await events(run.id)).slice(before).some((e) => e.kind === "operator_message")).toBe(false);
		}
	}, 180_000);

	it("Given a settled thread the user reopens, When its agent schedules a wake, Then the wake takes the thread up again", async () => {
		await pl.serviceWithRepo("reopened");
		const alert = am.fire({
			labels: { alertname: "ReopenedSlow fake-session:wakeup", service: "reopened", severity: "medium" },
			annotations: { summary: "reopened latency" },
		});
		await am.post(pl.webhookUrl, pl.webhookToken);
		const [incident] = await eventually(() => pl.incidentFor(alert.fingerprint), (f) => f.length === 1, "an incident");
		if (!incident) throw new Error("no incident");
		await pl.api(`/incidents/${incident.id}/investigate`, { method: "POST", body: { accessLevel: "supervised" } });
		const [run] = await eventually(() => pl.investigations(incident.id), (r) => r.length === 1, "the run");
		if (!run) throw new Error("no run");
		await eventually(async () => (await pl.investigation(run.id)).status, (s) => s === "completed", "the first turn ends", 60_000);
		await pl.api(`/threads/${run.id}/settle`, { method: "POST", body: { settled: true } });
		// The user reopens it with a message: new activity after the settle.
		await pl.api(`/investigations/${run.id}/messages`, { method: "POST", body: { text: "Look again please", mode: "queue" } });
		await eventually(
			async () => (await events(run.id)).some((e) => e.kind === "agent_step" && e.text.includes("Heard: Look again please")),
			Boolean,
			"the reopened thread answers",
			60_000,
		);
		await eventually(async () => (await pl.investigation(run.id)).status, (s) => s === "completed", "the follow-up ends", 60_000);
		const db = await pl.prisma();
		const wake = await db.threadWake.create({
			data: { investigationId: run.id, kind: "agent", at: new Date(Date.now() - 1000), reason: "Check after the reopen", payload: "{}" },
		});
		await (await pl.sessions()).process();
		await pl.tick();
		await eventually(
			async () => (await events(run.id)).some((e) => e.kind === "agent_step" && e.text.includes("Heard: Check after the reopen")),
			Boolean,
			"the wake takes the reopened thread up",
			60_000,
		);
		expect((await db.threadWake.findUnique({ where: { id: wake.id } }))?.state).not.toBe("cancelled");
	}, 180_000);
});
