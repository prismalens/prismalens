// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	eventually,
	type Incident,
	type Investigation,
	ScenarioApp,
} from "./support/scenario-app.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	type FakeAlertmanager,
	type ListedAlert,
	startFakeAlertmanager,
} from "../../../../scripts/fakes/fake-alertmanager.mjs";

const pl = new ScenarioApp();
let am: FakeAlertmanager;
let books: ListedAlert;
let orders: ListedAlert;
let target: Incident;
let source: Incident;

beforeAll(async () => {
	am = await startFakeAlertmanager();
	await pl.boot();
}, 60_000);
afterAll(async () => {
	vi.useRealTimers();
	await am.close();
	await pl.dispose();
});

const deliver = async () =>
	expect((await am.post(pl.webhookUrl, pl.webhookToken)).status).toBeLessThan(300);
const finished = (runs: Investigation[]) =>
	runs.length > 0 && runs.every((r) => !["pending", "running"].includes(r.status));

interface Merged extends Incident {
	mergedIntoId?: string | null;
	mergedInto?: { id: string; number: number } | null;
	priorIncident?: { number: number } | null;
	services?: Array<{ name: string }>;
}
interface RunWorkspace {
	workspace?: { layout: string; repos: Array<{ services: string[] }> } | null;
}

describe("#673 w37: one incident across two services", () => {
	it("Given two services' alerts on two incidents, When the operator merges one into the other, Then every alert moves and the source ends linked to the target", async () => {
		await pl.serviceWithRepo("books");
		await pl.serviceWithRepo("orders");
		books = am.fire({ labels: { alertname: "BooksSlow", service: "books", severity: "high" } });
		orders = am.fire({ labels: { alertname: "OrdersErrors", service: "orders", severity: "high" } });
		await deliver();
		[target] = await eventually(() => pl.incidentFor(books.fingerprint), (f) => f.length === 1, "the books incident");
		[source] = await eventually(() => pl.incidentFor(orders.fingerprint), (f) => f.length === 1, "the orders incident");
		expect(source.id).not.toBe(target.id);
		for (const i of [source, target])
			await eventually(() => pl.investigations(i.id), finished, "the alert's run to finish", 30_000);

		const merged = await pl.api<Incident>(`/incidents/${source.id}/merge`, {
			method: "POST",
			body: { targetId: target.id },
		});
		expect(merged.id).toBe(target.id);

		const after = await pl.api<Merged>(`/incidents/${source.id}`);
		expect(after.status).toBe("closed");
		expect(after.mergedIntoId).toBe(target.id);
		expect(after.mergedInto?.number).toBe(target.number);
		expect(after.alerts).toEqual([]);
		const into = await pl.api<Merged>(`/incidents/${target.id}`);
		expect(into.alerts?.map((a) => a.externalId).sort()).toEqual(
			[books.fingerprint, orders.fingerprint].sort(),
		);
		const timeline = await pl.api<unknown>(`/timeline?incidentId=${target.id}`);
		expect(JSON.stringify(timeline)).toContain(`Merged INC-${source.number}: 1 alert from orders`);
		const stats = await pl.api<{ total: number }>("/incidents/stats");
		expect(stats.total).toBe(1);
	}, 90_000);

	it("When the operator merges it again, or into an ended incident, Then it is refused", async () => {
		await expect(
			pl.api(`/incidents/${source.id}/merge`, { method: "POST", body: { targetId: target.id } }),
		).rejects.toThrow(/409/);
		await expect(
			pl.api(`/incidents/${target.id}/merge`, { method: "POST", body: { targetId: source.id } }),
		).rejects.toThrow(/409/);
		await expect(pl.api(`/incidents/${source.id}/investigate`, { method: "POST", body: {} })).rejects.toThrow(/409/);
	});

	it("When a run starts on the target, Then its workspace holds both services' repos", async () => {
		const started = await pl.api<{ investigationId: string }>(`/incidents/${target.id}/investigate`, {
			method: "POST",
			body: {},
		});
		const run = await eventually(
			() => pl.investigation(started.investigationId) as Promise<Investigation & RunWorkspace>,
			(i) => !["pending", "running"].includes(i.status),
			"the target's run to finish",
			30_000,
		);
		expect(run.workspace?.layout).toBe("multi");
		expect(run.workspace?.repos.flatMap((r) => r.services).sort()).toEqual(["books", "orders"]);
	}, 60_000);

	it("When the moved alert clears and fires again as a new episode, Then it lands on the target", async () => {
		am.clear(orders.fingerprint);
		await deliver();
		vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
		vi.setSystemTime(Date.now() + 25 * 60 * 60_000);
		am.fire({ labels: { alertname: "OrdersErrors", service: "orders", severity: "high" } });
		await deliver();

		const owners = await eventually(
			() => pl.api<Merged>(`/incidents/${target.id}`),
			(i) => (i.alerts ?? []).filter((a) => a.externalId === orders.fingerprint).length === 2,
			"the new episode on the target",
		);
		expect(owners.status).not.toBe("closed");
		expect((await pl.incidents()).map((i) => i.id).sort()).toEqual([source.id, target.id].sort());
	});

	it("When the target is resolved and the moved alert fires again, Then the new incident names the target", async () => {
		await pl.api(`/incidents/${target.id}/close`, { method: "POST", body: {} });
		await deliver();
		const [next] = await eventually(
			() => pl.incidentFor(orders.fingerprint).then((f) => f.filter((i) => i.id !== target.id)),
			(f) => f.length === 1,
			"a new orders incident after Resolve",
		);
		const opened = await pl.api<Merged>(`/incidents/${next.id}`);
		expect(opened.priorIncident?.number).toBe(target.number);
	});
});
