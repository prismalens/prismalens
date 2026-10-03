// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { eventually, type Investigation, ScenarioApp } from "./support/scenario-app.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type FakeAlertmanager,
	startFakeAlertmanager,
} from "../../../../scripts/fakes/fake-alertmanager.mjs";

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

const finished = (i: Investigation) => !["pending", "running"].includes(i.status);

describe("Walk f22: a follow-up after a real finished run", () => {
	it("Given a service with a repository, When its alert fires by webhook, Then an incident opens and its run completes with a report", async () => {
		await pl.serviceWithRepo("books");
		const alert = am.fire({
			labels: { alertname: "BooksListSlow", service: "books", severity: "critical" },
			annotations: { summary: "p99 of GET /books above 2s" },
		});
		expect((await am.post(pl.webhookUrl, pl.webhookToken)).status).toBeLessThan(300);

		const [incident] = await eventually(
			() => pl.incidentFor(alert.fingerprint),
			(found) => found.length === 1,
			"an incident carrying the alert",
		);
		const [run] = await eventually(
			() => pl.investigations(incident.id),
			(runs) => runs.length === 1,
			"the run the alert started",
		);
		const done = await eventually(() => pl.investigation(run.id), finished, "the run to finish", 30_000);
		expect(done.status).toBe("completed");
		expect(done.report?.rootCause).toContain("d37d888");
	}, 60_000);

	it("When the operator sends a follow-up on that finished run, Then it is accepted and answered in the same conversation", async () => {
		const [incident] = await pl.incidents();
		const [run] = await pl.investigations(incident.id);

		const sent = await pl.api<{ state: string }>(`/investigations/${run.id}/messages`, {
			method: "POST",
			body: { text: "Was anything else deployed?" },
		});
		expect(sent.state).toBe("resumed");

		await eventually(
			() => pl.investigation(run.id),
			(i) => i.status === "completed",
			"the follow-up turn to finish",
			30_000,
		);
		const events = await pl.api<unknown>(`/investigations/${run.id}/events`);
		expect(JSON.stringify(events)).toContain("On your question");
	}, 60_000);
});
