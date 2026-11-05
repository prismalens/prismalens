// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Schedule, ScheduleInput, ScheduleTick } from "@prismalens/contracts";
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
}, 60_000);
afterAll(async () => {
	await am.close();
	await pl.dispose();
});

const ended = (r: Investigation) => !["pending", "running"].includes(r.status);

async function incidentFrom(service: string, severity: string) {
	await pl.serviceWithRepo(service);
	const alert = am.fire({
		labels: { alertname: `${service} fake-session:success`, service, severity },
		annotations: { summary: `${service} is slow` },
	});
	expect((await am.post(pl.webhookUrl, pl.webhookToken, { only: [alert.fingerprint] })).status).toBeLessThan(300);
	const [incident] = await eventually(
		() => pl.incidentFor(alert.fingerprint),
		(found) => found.length === 1,
		`the ${service} incident`,
	);
	return incident;
}

describe("Walk #724: work that arrives during an update install waits for the restart", () => {
	it("Given admission drained, When a webhook, a manual start and a scheduled run arrive, Then each queues and starts after the restart", async () => {
		(await pl.admission()).drain();

		// A critical alert starts a run on its own: the webhook path.
		const fromWebhook = await incidentFrom("carts", "critical");
		const [webhookRun] = await eventually(
			() => pl.investigations(fromWebhook.id),
			(runs) => runs.length === 1,
			"the webhook's run to be queued",
		);

		// The operator starts one by hand.
		const quiet = await incidentFrom("ledger", "info");
		const existing = await pl.investigations(quiet.id);
		const manualRun =
			existing[0] ??
			{
				id: (
					await pl.api<{ investigationId: string; queued: boolean }>(`/incidents/${quiet.id}/investigate`, {
						method: "POST",
						body: { brief: "fake-session:success" },
					})
				).investigationId,
			};

		// A schedule fires.
		const service = await pl.serviceWithRepo("books");
		const input: ScheduleInput = {
			name: "Books check",
			serviceId: service.id,
			runbook: null,
			brief: "Check books fake-session:success",
			recurrence: { type: "cron", expr: "0 9 * * 1-5", timezone: "UTC" },
			harness: "claude-code",
			model: null,
			effort: null,
			missedPolicy: "run_once",
			catchUpMinutes: 60,
			repositoryId: null,
			accessLevel: null,
			report: true,
			whenAsks: "decide",
		};
		const schedule = await pl.api<Schedule>("/schedules", { method: "POST", body: input });
		const tick = await pl.api<ScheduleTick>(`/schedules/${schedule.id}/run`, { method: "POST" });
		expect(tick.outcome).toBe("run_now");
		const scheduledRun = tick.run as Investigation;

		await pl.tick();
		await new Promise((r) => setTimeout(r, 1_500));
		const ids = [webhookRun.id, manualRun.id, scheduledRun.id];
		for (const id of ids) expect((await pl.investigation(id)).status).toBe("pending");

		// The restart: a new process boots with admission open and claims what queued.
		await pl.stop();
		await pl.boot();
		for (const id of ids) {
			const done = await eventually(() => pl.investigation(id), ended, `run ${id} after the restart`, 60_000);
			expect(done.status).toBe("completed");
		}
	}, 180_000);

	it("Given admission restored after an abort, Then queued work starts without a restart", async () => {
		const admission = await pl.admission();
		admission.drain();
		const incident = await incidentFrom("search", "critical");
		const [run] = await eventually(
			() => pl.investigations(incident.id),
			(runs) => runs.length === 1,
			"the run to be queued",
		);
		await pl.tick();
		expect((await pl.investigation(run.id)).status).toBe("pending");
		admission.restore();
		const done = await eventually(() => pl.investigation(run.id), ended, "the run after admission is restored", 60_000);
		expect(done.status).toBe("completed");
	}, 120_000);
});
