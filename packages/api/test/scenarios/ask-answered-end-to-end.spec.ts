// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type FakeAlertmanager,
	startFakeAlertmanager,
} from "../../../../scripts/fakes/fake-alertmanager.mjs";
import {
	eventually,
	type Investigation,
	ScenarioApp,
} from "./support/scenario-app.js";

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

interface InvestigationWithApproval extends Investigation {
	awaitingApprovalAt?: string | null;
	accessLevel?: string | null;
}

/** An auto-started run is Auto unless Settings says otherwise; these walks need Ask always. */
async function autoStartAt(level: string) {
	await pl.api("/settings/harness", {
		method: "PATCH",
		body: { autoAccessLevels: { opencode: level } },
	});
}

describe("Walk: an ask answered end to end (#673 w21)", () => {
	it("Given an alert with fake-session:ask and no auto-start setting, When the run starts, Then it records accessLevel auto and runs on without an approval (#673)", async () => {
		await pl.serviceWithRepo("ledger");
		const alert = am.fire({
			labels: {
				alertname: "LedgerSlow fake-session:ask",
				service: "ledger",
				severity: "critical",
			},
			annotations: { summary: "ledger latency" },
		});
		expect(
			(await am.post(pl.webhookUrl, pl.webhookToken)).status,
		).toBeLessThan(300);

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

		const done = await eventually(
			() => pl.api<InvestigationWithApproval>(`/investigations/${run.id}`),
			(i) => i.status === "completed",
			"the run to complete without waiting for approval",
			30_000,
		);
		expect(done.accessLevel).toBe("auto");
		expect(done.awaitingApprovalAt).toBeNull();
	}, 60_000);

	it("Given an alert with fake-session:ask, When the agent asks permission and operator approves, Then the run completes with a report and a second answer returns 409", async () => {
		await autoStartAt("supervised");
		await pl.serviceWithRepo("books");
		const alert = am.fire({
			labels: {
				alertname: "BooksListSlow fake-session:ask",
				service: "books",
				severity: "critical",
			},
			annotations: { summary: "p99 of GET /books above 2s" },
		});
		expect(
			(await am.post(pl.webhookUrl, pl.webhookToken)).status,
		).toBeLessThan(300);

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

		const waiting = await eventually(
			() => pl.api<InvestigationWithApproval>(`/investigations/${run.id}`),
			(i) => Boolean(i.awaitingApprovalAt),
			"awaitingApprovalAt to be set",
			30_000,
		);
		expect(waiting.awaitingApprovalAt).toBeTruthy();

		const askEvent = await eventually(
			async () => {
				const page = await pl.api<{ events: CanonicalEvent[] }>(
					`/investigations/${run.id}/events`,
				);
				return page.events.find((e) => e.kind === "permission_ask");
			},
			(e) => Boolean(e),
			"permission_ask event in events",
			30_000,
		);
		if (!askEvent || askEvent.kind !== "permission_ask") {
			throw new Error("expected permission_ask event");
		}
		expect(askEvent.title).toBe("Write /tmp/pl-ask-probe.txt");
		const askId = askEvent.askId;

		const answer = await pl.api<{ outcome: string }>(
			`/investigations/${run.id}/asks/${askId}`,
			{
				method: "POST",
				body: { decision: "approve" },
			},
		);
		expect(answer).toEqual({ outcome: "approved" });

		const done = await eventually(
			() => pl.api<InvestigationWithApproval>(`/investigations/${run.id}`),
			(i) => i.status === "completed" && i.awaitingApprovalAt === null,
			"the run to complete with report and awaitingApprovalAt null",
			30_000,
		);
		expect(done.report?.rootCause).toContain("d37d888");
		expect(done.awaitingApprovalAt).toBeNull();

		await expect(
			pl.api(`/investigations/${run.id}/asks/${askId}`, {
				method: "POST",
				body: { decision: "approve" },
			}),
		).rejects.toThrow(/409/);
	}, 60_000);

	it("Given an alert with fake-session:ask, When the operator denies permission, Then permission_answer outcome is denied and the run still completes", async () => {
		await autoStartAt("supervised");
		await pl.serviceWithRepo("billing");
		const alert = am.fire({
			labels: {
				alertname: "BillingSlow fake-session:ask",
				service: "billing",
				severity: "critical",
			},
			annotations: { summary: "billing latency" },
		});
		expect(
			(await am.post(pl.webhookUrl, pl.webhookToken)).status,
		).toBeLessThan(300);

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

		await eventually(
			() => pl.api<InvestigationWithApproval>(`/investigations/${run.id}`),
			(i) => Boolean(i.awaitingApprovalAt),
			"awaitingApprovalAt to be set",
			30_000,
		);

		const askEvent = await eventually(
			async () => {
				const page = await pl.api<{ events: CanonicalEvent[] }>(
					`/investigations/${run.id}/events`,
				);
				return page.events.find((e) => e.kind === "permission_ask");
			},
			(e) => Boolean(e),
			"permission_ask event in events",
			30_000,
		);
		if (!askEvent || askEvent.kind !== "permission_ask") {
			throw new Error("expected permission_ask event");
		}
		expect(askEvent.title).toBe("Write /tmp/pl-ask-probe.txt");
		const askId = askEvent.askId;

		const answer = await pl.api<{ outcome: string }>(
			`/investigations/${run.id}/asks/${askId}`,
			{
				method: "POST",
				body: { decision: "deny" },
			},
		);
		expect(answer).toEqual({ outcome: "denied" });

		const done = await eventually(
			() => pl.api<InvestigationWithApproval>(`/investigations/${run.id}`),
			(i) => i.status === "completed" && i.awaitingApprovalAt === null,
			"the run to complete with report and awaitingApprovalAt null",
			30_000,
		);
		expect(done.report?.rootCause).toContain("d37d888");

		const afterEvents = await pl.api<{ events: CanonicalEvent[] }>(
			`/investigations/${run.id}/events`,
		);
		const answerEvent = afterEvents.events.find(
			(e) => e.kind === "permission_answer" && e.askId === askId,
		);
		if (!answerEvent || answerEvent.kind !== "permission_answer") {
			throw new Error("expected permission_answer event");
		}
		expect(answerEvent.outcome).toBe("denied");
	}, 60_000);

	it("Given an alert with fake-session:ask and autoAccessLevels auto-edits, When the run starts, Then it completes with permission_answer outcome allowed and no awaitingApprovalAt (#673 w21)", async () => {
		await pl.api("/settings/harness", {
			method: "PATCH",
			body: {
				autoAccessLevels: { opencode: "auto-edits" },
			},
		});

		await pl.serviceWithRepo("payments");
		const alert = am.fire({
			labels: {
				alertname: "PaymentsSlow fake-session:ask",
				service: "payments",
				severity: "critical",
			},
			annotations: { summary: "payments latency" },
		});
		expect(
			(await am.post(pl.webhookUrl, pl.webhookToken)).status,
		).toBeLessThan(300);

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

		const done = await eventually(
			() => pl.api<InvestigationWithApproval>(`/investigations/${run.id}`),
			(i) => i.status === "completed",
			"the run to complete without waiting for approval",
			30_000,
		);
		expect(done.awaitingApprovalAt).toBeNull();
		expect(done.report?.rootCause).toContain("d37d888");

		const eventsPage = await pl.api<{ events: CanonicalEvent[] }>(
			`/investigations/${run.id}/events`,
		);
		const askEvent = eventsPage.events.find((e) => e.kind === "permission_ask");
		expect(askEvent).toBeUndefined();

		const answerEvent = eventsPage.events.find(
			(e) => e.kind === "permission_answer",
		);
		if (!answerEvent || answerEvent.kind !== "permission_answer") {
			throw new Error("expected permission_answer event");
		}
		expect(answerEvent.outcome).toBe("allowed");
	}, 60_000);
});
