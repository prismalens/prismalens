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
		vi.setSystemTime(Date.now() + 25 * 60 * 60_000);
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

});

interface Lineage {
	id: string;
	number: number;
	status: string;
	reopenReason?: string | null;
	priorIncident?: { number: number; actualCause: string | null } | null;
	refiredAs?: { number: number } | null;
}

describe("R1a: the same alert after the operator's Resolve, and after Alerts cleared", () => {
	it("Given an incident resolved with a cause, When its alert fires again inside the flap window, Then a new incident names it and it names the new one", async () => {
		const fired = am.fire({ labels: { alertname: "PoolCapped", severity: "high" } });
		await deliver();
		const [first] = await eventually(
			() => pl.incidentFor(fired.fingerprint),
			(f) => f.length === 1,
			"the first incident",
		);
		await pl.api(`/incidents/${first.id}/close`, {
			method: "POST",
			body: { actualCause: "pool capped at 10" },
		});

		await deliver();
		const both = await eventually(
			() => pl.incidentFor(fired.fingerprint),
			(f) => f.length === 2,
			"a new incident after Resolve",
		);
		const next = both.find((i) => i.id !== first.id);
		const after = await pl.api<Lineage>(`/incidents/${next?.id}`);
		expect(after.status).toBe("triggered");
		expect(after.priorIncident).toMatchObject({
			number: first.number,
			actualCause: "pool capped at 10",
		});
		const old = await pl.api<Lineage>(`/incidents/${first.id}`);
		expect(old.status).toBe("closed");
		expect(old.refiredAs?.number).toBe(after.number);
	});

	it("Given an incident whose alerts cleared, When the alert fires again inside the flap window, Then the same incident is Triggered again and marked as a flap", async () => {
		const fired = am.fire({ labels: { alertname: "QueueLag", severity: "high" } });
		await deliver();
		const [incident] = await eventually(
			() => pl.incidentFor(fired.fingerprint),
			(f) => f.length === 1,
			"the incident",
		);
		am.clear(fired.fingerprint);
		await deliver();
		await eventually(
			() => pl.api<Lineage>(`/incidents/${incident.id}`),
			(i) => i.status === "resolved",
			"Alerts cleared",
		);

		am.fire({ labels: { alertname: "QueueLag", severity: "high" } });
		await deliver();
		const again = await eventually(
			() => pl.api<Lineage>(`/incidents/${incident.id}`),
			(i) => i.status === "triggered",
			"the same incident back",
		);
		expect(again.reopenReason).toBe("flap");
		expect(await pl.incidentFor(fired.fingerprint)).toHaveLength(1);
	});
});
