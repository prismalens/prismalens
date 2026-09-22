// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import { setTheme, SHOTS } from "./live-stream-fixtures";

/**
 * #523 S3 — one alert's full record.
 *
 * The demo seed already carries a correlated alert (ten of them, on incident
 * #1) and plenty of uncorrelated ones (the 44 standalone alerts), so this
 * spec reuses seed data rather than authoring new alerts — `alerts.create`
 * has no route this app exposes through the UI, only the ingest path. Seed
 * alerts carry no `rawPayload` though, so the payload-toggle assertion fakes
 * that one field onto the real `GET /api/alerts/:id` response, the same
 * one-field-rewrite technique `live-stream-fixtures.ts` uses for a run's
 * `status`.
 */
const CORRELATED_ALERT_ID = "a1111111-1111-4111-8111-111111111100";
const UNCORRELATED_ALERT_ID = "a9999999-9999-4999-8999-999999000000";

const shot = (page: Page, name: string) =>
	page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

async function servePayload(
	page: Page,
	alertId: string,
	payload: Record<string, unknown>,
): Promise<void> {
	await page.route(
		(url) => url.pathname === `/api/alerts/${alertId}`,
		async (route) => {
			const response = await route.fetch();
			const body = (await response.json()) as Record<string, unknown>;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					...body,
					rawPayload: JSON.stringify(payload),
				}),
			});
		},
	);
}

test.describe("#523 S3 — the alert record", () => {
	test("a correlated alert: identity, the incident link, the payload", async ({
		page,
	}) => {
		await servePayload(page, CORRELATED_ALERT_ID, {
			alertname: "APIGatewayHighErrorRate",
			status: "firing",
			labels: { severity: "critical", service: "api-gateway" },
		});

		await page.goto("/alerts");
		const row = page
			.getByTestId("alert-row-link")
			.filter({ hasText: "Storm alert #1:" });
		await expect(row).toBeVisible({ timeout: 15_000 });
		await row.click();

		await expect(page).toHaveURL(new RegExp(CORRELATED_ALERT_ID));
		const detail = page.getByTestId("alert-detail");
		await expect(detail).toBeVisible({ timeout: 15_000 });
		await setTheme(page, "light");
		await expect(detail).toBeVisible({ timeout: 15_000 });

		const incidentLink = detail.getByTestId("alert-incident");
		await expect(incidentLink).toBeVisible();
		await expect(incidentLink).toContainText("INC-1");

		const identity = page.locator("#identity");
		await expect(identity).toBeVisible();
		const dedupKey = identity.locator(".font-mono", { hasText: "demo-storm-alert-0" });
		await expect(dedupKey).toBeVisible();

		await page.getByTestId("alert-payload-toggle").click();
		await expect(page.getByTestId("alert-payload")).toContainText(
			"APIGatewayHighErrorRate",
		);

		await page.waitForLoadState("networkidle");
		await shot(page, "alert-detail-default");

		await setTheme(page, "dark");
		await expect(detail).toBeVisible();
		await page.waitForLoadState("networkidle");
		await shot(page, "alert-detail-dark");
	});

	test("an uncorrelated alert offers to run correlation", async ({ page }) => {
		await page.goto(`/alerts/${UNCORRELATED_ALERT_ID}`);
		const detail = page.getByTestId("alert-detail");
		await expect(detail).toBeVisible({ timeout: 15_000 });

		const uncorrelated = detail.getByTestId("alert-uncorrelated");
		await expect(uncorrelated).toBeVisible();
		await expect(uncorrelated.getByTestId("alert-correlate")).toBeVisible();
	});

	test("error — a nonexistent alert", async ({ page }) => {
		await page.goto("/alerts/00000000-0000-4000-8000-000000000000");
		await expect(page.getByText("Failed to load alert")).toBeVisible({
			timeout: 15_000,
		});
		await setTheme(page, "light");
		await expect(page.getByText("Failed to load alert")).toBeVisible();
		await page.waitForLoadState("networkidle");
		await shot(page, "alert-detail-error");
	});
});
