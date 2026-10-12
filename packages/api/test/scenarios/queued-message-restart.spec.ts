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

describe("Walk: a queued message survives a restart as \"not delivered\" (#820)", () => {
	it("Given an alert with fake-session:ask and a queued message, When PrismaLens restarts, Then the message is not delivered and the ask is answered (#820)", async () => {
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

		await eventually(
			() => pl.api<InvestigationWithApproval>(`/investigations/${run.id}`),
			(i) => Boolean(i.awaitingApprovalAt),
			"awaitingApprovalAt to be set",
			30_000,
		);

		const queuedResponse = await pl.api<{ state: string; messageId: string }>(
			`/investigations/${run.id}/messages`,
			{
				method: "POST",
				body: { text: "Also check the pool size.", mode: "queue" },
			},
		);
		expect(queuedResponse.state).toBe("queued");
		expect(typeof queuedResponse.messageId).toBe("string");
		expect(queuedResponse.messageId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
		const messageId = queuedResponse.messageId;

		await eventually(
			async () => {
				const page = await pl.api<{ events: CanonicalEvent[] }>(
					`/investigations/${run.id}/events`,
				);
				return page.events.find(
					(e) =>
						e.kind === "message_queued" &&
						e.messageId === messageId &&
						e.text === "Also check the pool size.",
				);
			},
			(e) => Boolean(e),
			"message_queued event in events",
			30_000,
		);

		await pl.stop();
		await pl.boot();

		const eventsAfterRestart = await eventually(
			async () => {
				const page = await pl.api<{ events: CanonicalEvent[] }>(
					`/investigations/${run.id}/events`,
				);
				return page.events;
			},
			(events) =>
				events.some(
					(e) =>
						e.kind === "operator_message" &&
						e.messageId === messageId &&
						e.delivered === false,
				),
			"operator_message event with delivered: false",
			30_000,
		);

		const deliveredTrue = eventsAfterRestart.find(
			(e) =>
				e.kind === "operator_message" &&
				e.messageId === messageId &&
				e.delivered === true,
		);
		expect(deliveredTrue).toBeUndefined();

		const askEvent = eventsAfterRestart.find((e) => e.kind === "permission_ask");
		expect(askEvent).toBeDefined();
		if (!askEvent || askEvent.kind !== "permission_ask") {
			throw new Error("expected permission_ask event");
		}

		const answerEvent = eventsAfterRestart.find(
			(e) => e.kind === "permission_answer" && e.askId === askEvent.askId,
		);
		expect(answerEvent).toBeDefined();
		if (!answerEvent || answerEvent.kind !== "permission_answer") {
			throw new Error("expected permission_answer event");
		}
		expect(["stopped", "restarted"]).toContain(answerEvent.outcome);
	}, 60_000);
});
