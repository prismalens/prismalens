// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import { setTheme, SHOTS } from "./live-stream-fixtures";

const shot = (page: Page, name: string) =>
	page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

test.describe("#523 — the alerts frame", () => {
	test("alerts frame layout, rows, and alert record", async ({ page }) => {
		// 1. /alerts redirects to the top alert
		await page.goto("/alerts");
		await expect(page).toHaveURL(/\/alerts\/[0-9a-f-]{36}/, { timeout: 15_000 });

		// 2. The frame and left pane
		const frame = page.getByTestId("alerts-frame");
		await expect(frame).toBeVisible({ timeout: 15_000 });
		const pane = page.getByTestId("alert-list-pane");
		await expect(pane).toBeVisible();

		// Header buttons
		await expect(page.getByTestId("alert-list-filters-toggle")).toBeVisible();
		await expect(page.getByTestId("alerts-view-stats")).toBeVisible();
		await expect(page.getByTestId("alerts-pull")).toBeVisible();

		// Tabs
		await expect(page.getByRole("tab", { name: "All Alerts" })).toBeVisible();
		await expect(page.getByRole("tab", { name: "Unmapped" })).toBeVisible();

		// Group labels and rows (firing first)
		await expect(page.getByTestId("group-firing")).toBeVisible();
		const rows = page.getByTestId("alert-row-link");
		await expect(rows.first()).toBeVisible();
		const count = await rows.count();
		expect(count).toBeGreaterThan(0);

		// Total count in footer
		await expect(page.getByTestId("alerts-total-count")).toBeVisible();

		// 3. The alert record in the centre
		const detail = page.getByTestId("alert-detail");
		await expect(detail).toBeVisible();
		await expect(detail.getByRole("heading").first()).toBeVisible();
		await expect(page.locator("#identity")).toBeVisible();

		// Screenshots: default (light) and dark
		await setTheme(page, "light");
		await expect(detail).toBeVisible();
		await page.waitForTimeout(500);
		await shot(page, "alerts-frame-default");

		await setTheme(page, "dark");
		await expect(detail).toBeVisible();
		await page.waitForTimeout(500);
		await shot(page, "alerts-frame-dark");
	});

	test("stats view shows numbers and live slots", async ({ page }) => {
		await page.goto("/alerts?view=stats");
		await expect(page.getByTestId("alerts-frame")).toBeVisible({ timeout: 20_000 });

		const overview = page.getByTestId("alerts-overview");
		await expect(overview).toBeVisible({ timeout: 20_000 });
		await expect(overview.getByTestId("live-slot").filter({ hasText: "Firing" })).toBeVisible();
		await expect(overview.getByTestId("live-slot")).toHaveCount(3);
	});

	test("acknowledging and resolving an alert from its record", async ({ page }) => {
		// Use a specific firing alert from seed
		await page.goto("/alerts");
		await expect(page.getByTestId("alerts-frame")).toBeVisible({ timeout: 30_000 });
		await expect(page).toHaveURL(/\/alerts\/[0-9a-f-]{36}/, { timeout: 30_000 });

		const detail = page.getByTestId("alert-detail");
		await expect(detail).toBeVisible({ timeout: 15_000 });

		const ackBtn = page.getByTestId("alert-acknowledge");
		if (await ackBtn.isVisible()) {
			await ackBtn.click();
			// After acknowledge, resolve button remains available
			await expect(page.getByTestId("alert-resolve")).toBeVisible({ timeout: 15_000 });
		} else {
			await expect(page.getByTestId("alert-resolve")).toBeVisible();
		}
	});

	test("empty — no alerts found", async ({ page }) => {
		await page.route("**/api/alerts*", async (route) => {
			if (route.request().method() === "GET") {
				const url = new URL(route.request().url());
				if (url.pathname === "/api/alerts") {
					await route.fulfill({
						status: 200,
						contentType: "application/json",
						body: JSON.stringify({
							data: [],
							pagination: { total: 0, limit: 100, offset: 0, hasMore: false },
						}),
					});
					return;
				}
			}
			await route.fallback();
		});

		await page.goto("/alerts?view=stats");
		await expect(page.getByTestId("alerts-empty-state")).toBeVisible({ timeout: 20_000 });
		await expect(page.getByText("No alerts found")).toBeVisible();

		await setTheme(page, "light");
		await page.waitForTimeout(500);
		await shot(page, "alerts-frame-empty");

		await page.unroute("**/api/alerts*");
	});
});
