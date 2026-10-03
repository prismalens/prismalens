// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";

test.describe("#523 — the alerts frame", () => {
	test("one alert list, in the sidebar; the page holds the window's controls", async ({
		page,
	}) => {
		// 1. /alerts stays the list's area; at this width the sidebar holds the list (study-v3 §8)
		await page.goto("/alerts");
		const frame = page.getByTestId("alerts-frame");
		await expect(frame).toBeVisible({ timeout: 15_000 });
		await expect(page).toHaveURL(/\/alerts$/);
		const pane = page.getByTestId("sidebar").getByTestId("alert-list-pane");
		await expect(pane).toBeVisible();
		await expect(page.getByTestId("alert-list-pane")).toHaveCount(1);

		// Header controls
		await expect(page.getByTestId("alert-list-filters-toggle")).toBeVisible();
		await expect(page.getByTestId("alerts-pull")).toBeVisible();
		await expect(page.getByTestId("alerts-total-count")).toBeVisible();
		await expect(page.getByRole("tab", { name: "All alerts" })).toBeVisible();
		await expect(page.getByRole("tab", { name: "Unmapped" })).toBeVisible();

		// Group labels and rows (firing first)
		await expect(pane.getByTestId("group-firing")).toBeVisible();
		const rows = pane.getByTestId("alert-row-link");
		await expect(rows.first()).toBeVisible();
		expect(await rows.count()).toBeGreaterThan(0);

		// 2. The alert record fills the page
		await rows.first().click();
		const detail = page.getByTestId("alert-detail");
		await expect(detail).toBeVisible();
		await expect(detail.getByRole("heading").first()).toBeVisible();
		await expect(page.locator("#identity")).toBeVisible();
	});

	test("stats view shows numbers and live slots", async ({ page }) => {
		await page.goto("/alerts?view=stats");
		await expect(page.getByTestId("alerts-frame")).toBeVisible({ timeout: 20_000 });

		const overview = page.getByTestId("alerts-overview");
		await expect(overview).toBeVisible({ timeout: 20_000 });
		await expect(overview.getByTestId("live-slot").filter({ hasText: "Firing" })).toBeVisible();
		await expect(overview.getByTestId("live-slot")).toHaveCount(3);
	});

	test("an alert leaves Acknowledge to its incident; Resolve is in its menu", async ({
		page,
	}) => {
		await page.goto("/alerts");
		const pane = page.getByTestId("sidebar").getByTestId("alert-list-pane");
		await pane
			.getByTestId("alert-row-link")
			.filter({ hasText: "Storm alert #1:" })
			.click();
		const detail = page.getByTestId("alert-detail");
		await expect(detail).toBeVisible({ timeout: 15_000 });

		await expect(detail.getByTestId("alert-open-incident")).toHaveText("Open INC-1");
		await expect(page.getByTestId("alert-acknowledge")).toHaveCount(0);
		await detail.getByTestId("alert-more").click();
		await expect(page.getByTestId("alert-resolve")).toBeVisible();
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

		await page.unroute("**/api/alerts*");
	});
});
