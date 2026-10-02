// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { eventually, ScenarioApp } from "./support/scenario-app.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type FakeAlertmanager,
	type ListedAlert,
	startFakeAlertmanager,
} from "../../../../scripts/fakes/fake-alertmanager.mjs";
import { startFakePrometheus } from "./support/fake-prometheus.js";

const pl = new ScenarioApp();
let am: FakeAlertmanager;
let prom: Awaited<ReturnType<typeof startFakePrometheus>>;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

beforeAll(async () => {
	am = await startFakeAlertmanager();
	prom = await startFakePrometheus();
	await pl.boot();
	await pl.connect("alertmanager", am.url);
	await pl.connect("prometheus", prom.url);
}, 60_000);
afterAll(async () => {
	await am.close();
	await prom.close();
	await pl.dispose();
});

async function firedByWebhook(alertname: string, startedMinutesAgo = 15): Promise<ListedAlert> {
	const labels = { alertname, severity: "warning" };
	const startsAt = minutesAgo(startedMinutesAgo);
	prom.firing(labels, startsAt);
	const alert = am.fire({ labels, startsAt: startsAt.toISOString() });
	expect((await am.post(pl.webhookUrl, pl.webhookToken, { only: [alert.fingerprint] })).status).toBeLessThan(300);
	await eventually(() => pl.incidentFor(alert.fingerprint), (f) => f.length === 1, `${alertname}'s incident`);
	await pl.postWebhookListing();
	return alert;
}

const pullNow = () => pl.api<{ resolvedByAbsence?: number }>("/alerts/pull", { method: "POST" });

describe("Walk f17: PrismaLens was down while an alert ended", () => {
	it("Given an alert that fired by webhook, When PrismaLens restarts while it still fires, Then catch-up adds no second incident", async () => {
		const alert = await firedByWebhook("BooksStillFiring");
		const before = (await pl.incidents()).length;
		await pl.stop();
		await pl.boot();
		await pullNow();

		expect(await pl.incidents()).toHaveLength(before);
		const [incident] = await pl.incidentFor(alert.fingerprint);
		expect(["resolved", "closed"]).not.toContain(incident.status);
	}, 60_000);

	it("Given an alert that fired by webhook, When it ends while PrismaLens is stopped, Then the boot pull resolves its incident and opens none", async () => {
		const alert = await firedByWebhook("BooksEndedWhileDown");
		const before = (await pl.incidents()).length;
		await pl.stop();
		prom.ended(alert.labels, minutesAgo(5));
		am.clear(alert.fingerprint);
		await pl.boot();

		const [incident] = await eventually(
			() => pl.incidentFor(alert.fingerprint),
			(f) => f[0]?.status === "resolved",
			"the boot pull to resolve the incident",
		);
		expect(incident.alerts?.every((a) => a.status === "resolved")).toBe(true);
		await pullNow();
		expect(await pl.incidents()).toHaveLength(before);
	}, 60_000);

	it("Given Alertmanager restarted minutes ago and lists nothing yet, When the operator pulls, Then absence proves nothing and the incident stays open", async () => {
		const alert = await firedByWebhook("BooksAfterAmRestart");
		am.restart();

		expect((await pullNow()).resolvedByAbsence ?? 0).toBe(0);
		const [incident] = await pl.incidentFor(alert.fingerprint);
		expect(["resolved", "closed"]).not.toContain(incident.status);
	}, 60_000);

	// R1 ruling 3 leaves why the walk's two fingerprints differed unconfirmed (4c456efb vs
	// 4e0b6168); with equal label sets the catch-up dedups with or without the source fix.
	it.todo("Given Prometheus's ALERTS series carries a label the webhook did not, When catch-up runs, Then it is the same alert (R1 ruling 3, lab vector)");
});
