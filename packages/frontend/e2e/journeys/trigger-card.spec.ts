// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { test } from "../steps/fixtures";
import {
	ensureService,
	fireIncident,
	LIVE,
	visit,
	waitForRun,
} from "../steps/product";

test.describe("a thread the world started shows its trigger first (#1020)", () => {
	test("an alert and a plain webhook use the same card", async ({
		page,
		alertmanager,
		deliverWebhook,
	}) => {
		const alerted = await fireIncident(page, alertmanager, deliverWebhook, {
			name: "TriggerCardLatency",
			service: LIVE,
			severity: "high",
			session: "success",
		});
		const run = await waitForRun(
			page,
			alerted.id,
			(r) => r.status === "completed",
			"alert run",
		);
		await visit(
			page,
			`/incidents/${alerted.id}/conversation?investigation=${run.id}`,
		);
		const card = page.getByTestId("trigger-card");
		await expect(card).toHaveAttribute("data-kind", "alert");
		await expect(card).toContainText("TriggerCardLatency");
		await expect(card).toContainText("alertname=TriggerCardLatency");

		await ensureService(page, { ...LIVE, trigger: "always" });
		const { token } = (await (
			await page.request.get("/api/webhooks/token")
		).json()) as { token: string };
		const hook = await page.request.post("/api/webhooks/generic", {
			headers: { authorization: `Bearer ${token}` },
			data: {
				title: "CI failed on main",
				source: "ci",
				serviceName: LIVE.name,
				labels: { branch: "main" },
				description: "fake-session:success",
			},
		});
		expect(hook.ok(), await hook.text()).toBe(true);
		const { incidentId } = (await hook.json()) as { incidentId: string };
		// A plain webhook opens its thread; a person starts the run on it.
		const started = await page.request.post(
			`/api/incidents/${incidentId}/investigate`,
			{ data: {} },
		);
		expect(started.ok(), await started.text()).toBe(true);
		const hookRun = await waitForRun(
			page,
			incidentId,
			(r) => r.status === "completed",
			"webhook run",
		);
		await visit(
			page,
			`/incidents/${incidentId}/conversation?investigation=${hookRun.id}`,
		);
		await expect(card).toHaveAttribute("data-kind", "webhook");
		await expect(card).toContainText("Started by a webhook");
		await expect(card).toContainText("ci");
		await expect(card).toContainText("branch=main");
	});
});
