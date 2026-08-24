// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";

/**
 * Mapping-health query and "Alert Mapping Issues" card (issue #452, closes #294 journey point 3).
 *
 * Asserts:
 *  1. Every number the card shows comes from the live health query (5 unmapped services in demo seed).
 *  2. "View in Rules" links to `/rules?tab=mapping`, where the exact counted issues are listed.
 *  3. Rule creation transitions health state: unmapped service count decrements and the new rule
 *     reports "Never matched" until alerts arrive.
 *  4. Count equality: the count the card shows equals the count the linked view displays.
 *  5. Empty state: "No mapping issues detected" renders only when the query returns 0 issues.
 */

const SHOTS = "e2e/journeys/screenshots";
const MAPPING_RULE_NAME = "API Gateway Routing Rule";
const MAPPING_SERVICE_LABEL = "API Gateway";

async function cleanupRules(page: Page) {
	const response = await page.request.get("/api/alert-mapping/rules");
	if (response.ok()) {
		const rules = (await response.json()) as { id: string; name: string }[];
		for (const rule of rules.filter((r) => r.name === MAPPING_RULE_NAME)) {
			await page.request.delete(`/api/alert-mapping/rules/${rule.id}`);
		}
	}
}

async function serveEmptyMappingHealth(page: Page): Promise<void> {
	await page.route(
		(url) => url.pathname === "/api/alert-mapping/health",
		async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					summary: {
						totalIssues: 0,
						unmappedServicesCount: 0,
						neverMatchedRulesCount: 0,
						stoppedMatchingRulesCount: 0,
						healthyRulesCount: 5,
						disabledRulesCount: 0,
						totalRules: 5,
						totalServices: 5,
						windowHours: 168,
					},
					issues: [],
					services: [],
					rules: [],
				}),
			});
		},
	);
}

test.describe.configure({ mode: "serial" });

test.describe("Mapping-health query & Alert Mapping Issues card (#452)", () => {
	test("card displays live query total, links to /rules?tab=mapping, and reflects rule health", async ({
		page,
	}) => {
		test.setTimeout(120_000);

		await page.goto("/");
		await cleanupRules(page);
		await page.reload();

		// 1. Dashboard "Alert Mapping Issues" card is visible
		await expect(
			page.getByRole("heading", { name: "Command Center" }),
		).toBeVisible({ timeout: 15_000 });

		const card = page
			.locator("div")
			.filter({ hasText: /^Alert Mapping Issues/ })
			.first();
		await expect(card).toBeVisible({ timeout: 15_000 });

		// Seeded demo DB has 5 services and 0 mapping rules -> 5 unmapped services
		await expect(card.getByText("5")).toBeVisible({ timeout: 15_000 });
		await expect(card.getByText("Unmapped").first()).toBeVisible();

		// 2. View in Rules link points to /rules?tab=mapping
		const viewLink = card.getByRole("link", { name: /View in Rules/i });
		await expect(viewLink).toBeVisible();
		await viewLink.click();

		// 3. /rules?tab=mapping renders unmapped services banner with exact count
		await expect(page).toHaveURL(/\/rules\?tab=mapping/);
		const banner = page.getByTestId("unmapped-services-banner");
		await expect(banner).toBeVisible({ timeout: 15_000 });
		await expect(banner).toContainText("5 unmapped services");
		await expect(banner).toContainText("API Gateway");

		// 4. Create a mapping rule for API Gateway
		await page.getByRole("button", { name: "Add rule" }).first().click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await dialog.locator("#mapping-rule-name").fill(MAPPING_RULE_NAME);
		await dialog.locator("#mapping-rule-service").click();
		await page.getByRole("option", { name: MAPPING_SERVICE_LABEL }).click();
		await dialog.getByRole("button", { name: "Create rule" }).click();
		await expect(dialog).toBeHidden();

		// 5. Unmapped count decreases to 4 and the created rule shows "Never matched"
		await expect(banner).toContainText("4 unmapped services");
		const row = page.getByRole("row", { name: new RegExp(MAPPING_RULE_NAME) });
		await expect(row).toBeVisible();
		await expect(row.getByText("Never matched")).toBeVisible();

		// 6. Return to dashboard: card count is 5 (4 unmapped services + 1 never matched rule)
		await page.goto("/");
		await expect(
			page.getByRole("heading", { name: "Command Center" }),
		).toBeVisible({ timeout: 15_000 });
		const updatedCard = page
			.locator("div")
			.filter({ hasText: /^Alert Mapping Issues/ })
			.first();
		await expect(updatedCard.getByText("5")).toBeVisible({ timeout: 15_000 });

		// Clean up created rule
		await cleanupRules(page);
	});

	test("empty state renders only when query genuinely returns zero issues", async ({
		page,
	}) => {
		test.setTimeout(60_000);

		await serveEmptyMappingHealth(page);
		await page.goto("/");
		await expect(
			page.getByRole("heading", { name: "Command Center" }),
		).toBeVisible({ timeout: 15_000 });

		const card = page
			.locator("div")
			.filter({ hasText: /^Alert Mapping Issues/ })
			.first();
		await expect(card).toBeVisible({ timeout: 15_000 });
		await expect(card.getByText("0")).toBeVisible();
		await expect(card.getByText("No mapping issues detected")).toBeVisible();
	});

	test("design evidence: default, dark, and empty states", async ({ page }) => {
		test.setTimeout(120_000);

		const shot = (name: string) =>
			page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

		const setTheme = async (theme: "light" | "dark") => {
			await page.evaluate((value) => {
				document.cookie = `prismalens-theme=${value}; path=/; max-age=31536000`;
			}, theme);
			await page.reload();
			await expect(page.locator("html")).toHaveClass(new RegExp(theme));
		};

		await page.goto("/");
		await cleanupRules(page);
		await expect(
			page.getByRole("heading", { name: "Command Center" }),
		).toBeVisible({ timeout: 15_000 });

		// 1. Default (light): card populated with live issues
		await setTheme("light");
		await expect(
			page.locator("div").filter({ hasText: /^Alert Mapping Issues/ }).first(),
		).toBeVisible({ timeout: 15_000 });
		await page.waitForLoadState("networkidle");
		await shot("mapping-health-default");

		// 2. Dark
		await setTheme("dark");
		await expect(
			page.locator("div").filter({ hasText: /^Alert Mapping Issues/ }).first(),
		).toBeVisible({ timeout: 15_000 });
		await page.waitForLoadState("networkidle");
		await shot("mapping-health-dark");

		// 3. Empty state
		await setTheme("light");
		await serveEmptyMappingHealth(page);
		await page.goto("/");
		await expect(
			page.locator("div").filter({ hasText: /^Alert Mapping Issues/ }).first(),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText("No mapping issues detected")).toBeVisible({
			timeout: 15_000,
		});
		await page.waitForLoadState("networkidle");
		await shot("mapping-health-empty");
	});
});
