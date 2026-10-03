// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { eventually, ScenarioApp } from "./support/scenario-app.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	type FakeAlertmanager,
	type ListedAlert,
	startFakeAlertmanager,
} from "../../../../scripts/fakes/fake-alertmanager.mjs";

const pl = new ScenarioApp();
let am: FakeAlertmanager;
let alert: ListedAlert;
let firstIncidentId = "";
const labels = { alertname: "BooksListSlow", severity: "critical" };

beforeAll(async () => {
	am = await startFakeAlertmanager();
	await pl.boot();
	// Only Date moves: timers and sockets keep real time.
	vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
}, 60_000);
afterAll(async () => {
	vi.useRealTimers();
	await am.close();
	await pl.dispose();
});

const deliver = async () =>
	expect((await am.post(pl.webhookUrl, pl.webhookToken)).status).toBeLessThan(300);

describe("Walk f32: the same alert fires again after its incident ended", () => {
	it("Given an incident opened by an alert, When the operator resolves it, Then its alert stops firing too", async () => {
		alert = am.fire({ labels });
		await deliver();
		const [incident] = await eventually(
			() => pl.incidentFor(alert.fingerprint),
			(f) => f.length === 1,
			"the first incident",
		);
		firstIncidentId = incident.id;

		await pl.api(`/incidents/${incident.id}/resolve`, { method: "POST" });

		const [after] = await pl.incidentFor(alert.fingerprint);
		expect(after.status).toBe("resolved");
		expect(after.alerts?.map((a) => a.status)).toEqual(["resolved"]);
	});

	it("When the same alert fires again after the flap window, Then a new incident opens and names the one that ended", async () => {
		am.clear(alert.fingerprint);
		await deliver();
		vi.setSystemTime(Date.now() + 20 * 60_000);
		am.fire({ labels });
		await deliver();

		const incidents = await eventually(
			() => pl.incidentFor(alert.fingerprint),
			(f) => f.length === 2,
			"a second incident",
		);
		const second = incidents.find((i) => i.id !== firstIncidentId);
		expect(second?.status).not.toBe("resolved");
		const timeline = await pl.api<{ data: Array<{ metadata?: unknown }> }>(
			`/timeline?incidentId=${second?.id}`,
		);
		expect(JSON.stringify(timeline)).toContain(firstIncidentId);
	});

	// Decision 3 (one-step Resolve) re-rules both; the R1 addendum is the reference.
	it.todo("When it fires again inside the flap window after Resolve, Then … (R1 addendum: reopen or a new linked incident)");
	it.todo("Given an incident closed with a cause, When its alert fires again, Then … (R1 addendum: what `closed` means after decision 3)");
});
