// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { eventually, ScenarioApp } from "./support/scenario-app.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type FakeAlertmanager,
	startFakeAlertmanager,
} from "../../../../scripts/fakes/fake-alertmanager.mjs";

const pl = new ScenarioApp();
let ours: FakeAlertmanager;
let foreign: FakeAlertmanager;

beforeAll(async () => {
	ours = await startFakeAlertmanager();
	foreign = await startFakeAlertmanager();
	await pl.boot();
}, 60_000);
afterAll(async () => {
	await ours.close();
	await foreign.close();
	await pl.dispose();
});

const pullNow = () =>
	pl.api<{ resolvedByAbsence?: number }>("/alerts/pull", { method: "POST" });

async function firedByWebhook(am: FakeAlertmanager, alertname: string) {
	const alert = am.fire({ labels: { alertname, severity: "warning" } });
	expect(
		(await am.post(pl.webhookUrl, pl.webhookToken, { only: [alert.fingerprint] }))
			.status,
	).toBeLessThan(300);
	await eventually(
		() => pl.incidentFor(alert.fingerprint),
		(f) => f.length === 1,
		`${alertname}'s incident`,
	);
	return alert;
}

describe("Walk f17: an alert fired by webhook before its Alertmanager was connected", () => {
	it("Given a webhook alert from an Alertmanager not yet connected, When the operator connects it and it later stops listing the alert, Then the pull resolves the incident by absence and opens none", async () => {
		const alert = await firedByWebhook(ours, "BooksBeforeConnect");
		await pl.postWebhookListing();
		expect(await pl.lastListedAt(alert.fingerprint)).toBeNull();
		const before = (await pl.incidents()).length;

		await pl.connect("alertmanager", ours.url);
		await eventually(
			() => pl.lastListedAt(alert.fingerprint),
			(at) => at !== null,
			"connecting to list the Alertmanager",
			5_000,
		);
		ours.clear(alert.fingerprint);

		expect((await pullNow()).resolvedByAbsence).toBe(1);
		const [incident] = await pl.incidentFor(alert.fingerprint);
		expect(incident.status).toBe("resolved");
		expect(await pl.incidents()).toHaveLength(before);
	}, 60_000);

	it("Given a webhook alert from an Alertmanager that is not connected, When a pull runs, Then absence from the connected one never resolves it", async () => {
		const alert = await firedByWebhook(foreign, "BooksFromElsewhere");
		await pl.postWebhookListing();

		expect((await pullNow()).resolvedByAbsence ?? 0).toBe(0);
		const [incident] = await pl.incidentFor(alert.fingerprint);
		expect(["resolved", "closed"]).not.toContain(incident.status);
	}, 60_000);
});
