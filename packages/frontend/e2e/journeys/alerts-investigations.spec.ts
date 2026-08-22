// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";

const SHOTS = "e2e/journeys/screenshots";

test.describe("D4 substitute — alerts triage & culprit rendering journey", () => {
	test("asserts total alert count and culprit / no-culprit investigation rendering", async ({
		page,
	}) => {
		// 1. Navigate to /alerts and assert total alerts count is 60 (#309 pagination assertion)
		await page.goto("/alerts");
		await expect(
			page.getByRole("heading", { name: "Alerts" }),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("alerts-total-count")).toHaveText("60", {
			timeout: 15_000,
		});

		// 2. Navigate to /investigations list page
		await page.goto("/investigations");
		await expect(
			page.getByRole("heading", { name: "Investigations" }),
		).toBeVisible({ timeout: 15_000 });

		// 3. Open culprit investigation (d0111111) and verify culprit fields on Analysis tab
		await page.goto("/investigations/d0111111-1111-4111-8111-111111111111");
		await expect(
			page.getByRole("tab", { name: "Analysis" }),
		).toBeVisible({ timeout: 15_000 });
		await page.getByRole("tab", { name: "Analysis" }).click();
		await expect(
			page.getByText("auth-service", { exact: false }).first(),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText("v2.4.1", { exact: true })).toBeVisible({
			timeout: 15_000,
		});
		await expect(
			page.getByText("connection-pool exhaustion", { exact: false }).first(),
		).toBeVisible({ timeout: 15_000 });

		// 4. Open no-culprit investigation (d0222222) and verify the stable
		//    no-culprit state: report renders, but absence stays absence —
		//    no service, change ref, or mechanism is invented (culprit: null
		//    in the seed, so AnalysisTab must render no Culprit section at all).
		await page.goto("/investigations/d0222222-2222-4222-8222-222222222222");
		await expect(
			page.getByRole("tab", { name: "Analysis" }),
		).toBeVisible({ timeout: 15_000 });
		await page.getByRole("tab", { name: "Analysis" }).click();
		await expect(page.getByText("Root Cause Analysis")).toBeVisible({
			timeout: 15_000,
		});
		await expect(
			page.getByText(
				"Upstream payment provider experiencing elevated processing latencies.",
			),
		).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByText("Culprit", { exact: true }),
		).not.toBeVisible();
	});

	/**
	 * #tab=unmapped — the dashboard's "Unassigned" links (`/alerts?tab=unmapped`)
	 * used to do nothing: the alerts route declared no `validateSearch`, so the
	 * param was silently dropped. The route now honours it via a real,
	 * backend-filterable field (`hasIncident`, AlertQuerySchema) — not an
	 * invented one.
	 */
	test("tab=unmapped filters alerts to those with no incident", async ({
		page,
	}) => {
		// 1. Direct link (as the dashboard sends it): the Unmapped tab is
		//    pre-selected and the table only shows alerts with no incident.
		await page.goto("/alerts?tab=unmapped");
		await expect(
			page.getByRole("heading", { name: "Alerts" }),
		).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByRole("tab", { name: "Unmapped", selected: true }),
		).toBeVisible({ timeout: 15_000 });

		const rows = page.locator("table tbody tr");
		await expect(rows.first()).toBeVisible({ timeout: 15_000 });
		const rowCount = await rows.count();
		expect(rowCount).toBeGreaterThan(0);
		expect(rowCount).toBeLessThan(60); // fewer than the full 60-alert seed
		// An unmapped alert renders no "INC-" incident link (AlertsTable).
		await expect(page.getByText(/^INC-/)).toHaveCount(0);

		// 2. Switching tabs updates the URL and the result set.
		await page.getByRole("tab", { name: "All Alerts" }).click();
		await expect(page).toHaveURL(/tab=all/);
		await expect(page.getByTestId("alerts-total-count")).toHaveText("60", {
			timeout: 15_000,
		});

		// 3. The real repro: the dashboard's "Unassigned" link actually navigates
		//    and lands with the Unmapped tab selected.
		await page.goto("/");
		await page.getByRole("link", { name: /Unassigned:/ }).click();
		await expect(page).toHaveURL(/\/alerts\?tab=unmapped/);
		await expect(
			page.getByRole("tab", { name: "Unmapped", selected: true }),
		).toBeVisible({ timeout: 15_000 });
	});

	test("tab=unmapped excludes resolved and suppressed alerts even if they lack an incident", async ({
		page,
	}) => {
		await page.route(
			(url) =>
				url.pathname === "/api/alerts" &&
				url.searchParams.get("hasIncident") === "false",
			async (route) => {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						data: [
							{
								id: "a0000001-0000-4000-8000-000000000001",
								dedupKey: "alert-triggered",
								title: "Triggered Alert Without Incident",
								severity: "high",
								status: "triggered",
								incidentId: null,
								triggeredAt: new Date().toISOString(),
								occurrenceCount: 1,
								lastOccurrence: new Date().toISOString(),
								createdAt: new Date().toISOString(),
								updatedAt: new Date().toISOString(),
							},
							{
								id: "a0000002-0000-4000-8000-000000000002",
								dedupKey: "alert-acknowledged",
								title: "Acknowledged Alert Without Incident",
								severity: "medium",
								status: "acknowledged",
								incidentId: null,
								triggeredAt: new Date().toISOString(),
								occurrenceCount: 1,
								lastOccurrence: new Date().toISOString(),
								createdAt: new Date().toISOString(),
								updatedAt: new Date().toISOString(),
							},
							{
								id: "a0000003-0000-4000-8000-000000000003",
								dedupKey: "alert-resolved",
								title: "Resolved Alert Without Incident",
								severity: "low",
								status: "resolved",
								incidentId: null,
								triggeredAt: new Date().toISOString(),
								occurrenceCount: 1,
								lastOccurrence: new Date().toISOString(),
								createdAt: new Date().toISOString(),
								updatedAt: new Date().toISOString(),
							},
							{
								id: "a0000004-0000-4000-8000-000000000004",
								dedupKey: "alert-suppressed",
								title: "Suppressed Alert Without Incident",
								severity: "info",
								status: "suppressed",
								incidentId: null,
								triggeredAt: new Date().toISOString(),
								occurrenceCount: 1,
								lastOccurrence: new Date().toISOString(),
								createdAt: new Date().toISOString(),
								updatedAt: new Date().toISOString(),
							},
						],
						pagination: { total: 4, limit: 100, offset: 0, hasMore: false },
					}),
				});
			},
		);

		await page.goto("/alerts?tab=unmapped");
		await expect(
			page.getByRole("tab", { name: "Unmapped", selected: true }),
		).toBeVisible({ timeout: 15_000 });

		// Triggered and Acknowledged alerts should be rendered
		await expect(
			page.getByText("Triggered Alert Without Incident"),
		).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByText("Acknowledged Alert Without Incident"),
		).toBeVisible({ timeout: 15_000 });

		// Resolved and Suppressed alerts should NOT be rendered in the unmapped tab
		await expect(
			page.getByText("Resolved Alert Without Incident"),
		).not.toBeVisible();
		await expect(
			page.getByText("Suppressed Alert Without Incident"),
		).not.toBeVisible();

		await page.unroute("**/api/alerts");
	});

	test("design evidence: alerts unmapped tab in default, dark, and empty states", async ({
		page,
	}) => {
		const shot = (name: string) =>
			page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

		const setTheme = async (theme: "light" | "dark") => {
			await page.evaluate((value) => {
				document.cookie = `prismalens-theme=${value}; path=/; max-age=31536000`;
			}, theme);
			await page.reload();
			await expect(page.locator("html")).toHaveClass(new RegExp(theme));
		};

		await page.goto("/alerts?tab=unmapped");
		await expect(
			page.getByRole("tab", { name: "Unmapped", selected: true }),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.locator("table tbody tr").first()).toBeVisible({
			timeout: 15_000,
		});

		await setTheme("light");
		await page.waitForLoadState("networkidle");
		await shot("alerts-unmapped-default");

		await setTheme("dark");
		await page.waitForLoadState("networkidle");
		await shot("alerts-unmapped-dark");

		// Empty: no alert in the seed is genuinely unmapped-and-nothing-else, so
		// the empty state is reached by stubbing the filtered response rather
		// than deleting seed data.
		await page.route(
			(url) =>
				url.pathname === "/api/alerts" &&
				url.searchParams.get("hasIncident") === "false",
			async (route) => {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						data: [],
						pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
					}),
				});
			},
		);
		await page.reload();
		await expect(page.getByText("No alerts found")).toBeVisible({
			timeout: 15_000,
		});
		await page.waitForLoadState("networkidle");
		await shot("alerts-unmapped-empty");
		await page.unroute("**/api/alerts");
	});

	test("design evidence: investigation detail page in default and dark themes", async ({
		page,
	}) => {
		const DETAIL_URL = "/investigations/d0111111-1111-4111-8111-111111111111";

		const setTheme = async (theme: "light" | "dark") => {
			await page.evaluate((value) => {
				document.cookie = `prismalens-theme=${value}; path=/; max-age=31536000`;
			}, theme);
			await page.reload();
			await expect(page.locator("html")).toHaveClass(new RegExp(theme));
		};

		// Default/Light state: set theme to light
		await page.goto(DETAIL_URL);
		await expect(
			page.getByRole("tab", { name: "Analysis" }),
		).toBeVisible({ timeout: 15_000 });
		await setTheme("light");
		await page.waitForLoadState("networkidle");
		await page.screenshot({
			path: `${SHOTS}/investigation-detail-default.png`,
			fullPage: true,
		});

		// Dark state: set theme to dark
		await setTheme("dark");
		await page.waitForLoadState("networkidle");
		await page.screenshot({
			path: `${SHOTS}/investigation-detail-dark.png`,
			fullPage: true,
		});
	});
});
