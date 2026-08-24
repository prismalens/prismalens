// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";

/**
 * J15 — rule management (#294). Every affordance on `/rules` must round-trip to
 * a real endpoint, so this spec drives the UI and asserts on what the engine
 * actually returns, never on optimistic local state.
 */

const SHOTS = "e2e/journeys/screenshots";

const CORRELATION_RULE_NAME = "Suppress checkout noise";
const MAPPING_RULE_NAME = "Prometheus checkout alerts";
const MAPPING_SERVICE_LABEL = "API Gateway";

/**
 * The demo seed ships two correlation rules and zero mapping rules, so the
 * correlation tab is never empty and the mapping tab is the surface's genuine
 * empty state. Only rules this spec creates are removed — deleting a seeded
 * correlation rule would break the incidents that reference it.
 */
async function deleteRulesCreatedByThisSpec(page: Page) {
	for (const [path, name] of [
		["correlation/rules", CORRELATION_RULE_NAME],
		["alert-mapping/rules", MAPPING_RULE_NAME],
	] as const) {
		const response = await page.request.get(`/api/${path}`);
		expect(response.ok()).toBe(true);
		const rules = (await response.json()) as { id: string; name: string }[];
		for (const rule of rules.filter((r) => r.name === name)) {
			await page.request.delete(`/api/${path}/${rule.id}`);
		}
	}
}

async function createCorrelationRule(page: Page) {
	await page.getByRole("button", { name: "Add rule" }).first().click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await dialog.locator("#correlation-rule-name").fill(CORRELATION_RULE_NAME);
	await dialog.locator("#correlation-rule-action").click();
	await page.getByRole("option", { name: "Suppress the alert" }).click();
	await dialog.getByRole("button", { name: "Create rule" }).click();
	await expect(dialog).toBeHidden();
}

async function createMappingRule(page: Page) {
	await page.getByRole("button", { name: "Add rule" }).first().click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await dialog.locator("#mapping-rule-name").fill(MAPPING_RULE_NAME);
	await dialog.locator("#mapping-rule-service").click();
	await page.getByRole("option", { name: MAPPING_SERVICE_LABEL }).click();
	await dialog.getByRole("button", { name: "Create rule" }).click();
	await expect(dialog).toBeHidden();
}

async function createCorrelationRuleExpectingConflict(page: Page) {
	await page.getByRole("button", { name: "Add rule" }).first().click();
	const dialog = page.getByRole("dialog");
	await dialog.locator("#correlation-rule-name").fill(CORRELATION_RULE_NAME);
	await dialog.getByRole("button", { name: "Create rule" }).click();
	await expect(dialog.getByText(/already exists/)).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.describe("J15 — correlation & alert-mapping rule management", () => {
	test("rules round-trip through the real correlation and mapping endpoints", async ({
		page,
	}) => {
		test.setTimeout(120_000);

		await page.goto("/");
		await deleteRulesCreatedByThisSpec(page);

		// 1. The screen is reachable from the navbar and both halves render.
		await page.getByRole("link", { name: "Rules", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Rules" })).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByRole("tab", { name: "Correlation" })).toBeVisible();
		await expect(
			page.getByRole("tab", { name: "Alert mapping" }),
		).toBeVisible();

		// 2. Create a suppression rule — the contract enum, saved for real.
		await createCorrelationRule(page);
		const row = page.getByRole("row", {
			name: new RegExp(CORRELATION_RULE_NAME),
		});
		await expect(row).toBeVisible();
		await expect(row.getByText("suppress", { exact: true })).toBeVisible();

		// 3. The test affordance evaluates the SAVED rule set on the server.
		await page.getByRole("button", { name: "Test with sample alert" }).click();
		const testDialog = page.getByRole("dialog");
		await testDialog.getByRole("button", { name: "Run test" }).click();
		const result = page.getByTestId("correlation-test-result");
		await expect(result).toContainText(CORRELATION_RULE_NAME);
		await expect(result).toContainText("suppress");
		await expect(result).toContainText(
			`Suppressed by rule: ${CORRELATION_RULE_NAME}`,
		);
		await testDialog
			.getByRole("button", { name: "Close" })
			.first()
			.click();

		// 4. Disabling the rule changes what the engine reports — proof the toggle
		//    writes and the test panel is not reading a cached answer.
		await row.getByRole("checkbox").click();
		await expect(row.getByRole("checkbox")).not.toBeChecked();
		await page.getByRole("button", { name: "Test with sample alert" }).click();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Run test" })
			.click();
		await expect(page.getByTestId("correlation-test-result")).toContainText(
			"No rule matched",
		);
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Close" })
			.first()
			.click();
		await row.getByRole("checkbox").click();
		await expect(row.getByRole("checkbox")).toBeChecked();

		// 5. The mapping half, against its own endpoints.
		await page.getByRole("tab", { name: "Alert mapping" }).click();
		await expect(page).toHaveURL(/tab=mapping/);
		await expect(page.getByText("No alert mapping rules")).toBeVisible();

		await page.getByRole("button", { name: "Add rule" }).first().click();
		const mappingDialog = page.getByRole("dialog");
		await mappingDialog.locator("#mapping-rule-name").fill(MAPPING_RULE_NAME);
		await mappingDialog.locator("#mapping-rule-service").click();
		await page.getByRole("option", { name: MAPPING_SERVICE_LABEL }).click();
		await mappingDialog.getByRole("button", { name: "Create rule" }).click();
		await expect(mappingDialog).toBeHidden();

		const mappingRow = page.getByRole("row", {
			name: new RegExp(MAPPING_RULE_NAME),
		});
		await expect(mappingRow).toBeVisible();
		await expect(mappingRow).toContainText(MAPPING_SERVICE_LABEL);

		await page.getByRole("button", { name: "Test with sample alert" }).click();
		const mappingTest = page.getByRole("dialog");
		await mappingTest.getByRole("button", { name: "Run test" }).click();
		const mappingResult = page.getByTestId("mapping-test-result");
		await expect(mappingResult).toContainText(MAPPING_RULE_NAME);
		await expect(mappingResult).toContainText("Service: api-gateway");
		await mappingTest
			.getByRole("button", { name: "Close" })
			.first()
			.click();

		// 6. Delete round-trips too: the row is gone after a refetch.
		await mappingRow.getByRole("button", { name: "Delete" }).click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Delete" })
			.click();
		await expect(mappingRow).toHaveCount(0);
		await expect(page.getByText("No alert mapping rules")).toBeVisible();
	});

	/**
	 * Design evidence for the frontend gate (AGENTS.md): default, dark, empty and
	 * error, captured the same way `live-canvas.spec.ts` captures the canvas.
	 */
	test("design evidence: default, dark, empty and error states", async ({
		page,
	}) => {
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

		await page.goto("/rules");
		await expect(page.getByRole("heading", { name: "Rules" })).toBeVisible({
			timeout: 15_000,
		});
		await setTheme("light");

		// Empty: the mapping tab, which the demo seed leaves genuinely empty.
		await page.getByRole("tab", { name: "Alert mapping" }).click();
		await expect(page.getByText("No alert mapping rules")).toBeVisible();
		await page.waitForLoadState("networkidle");
		await shot("rules-empty");

		// Default: the correlation tab, populated by the seed plus this suite's rule.
		await page.getByRole("tab", { name: "Correlation" }).click();
		await expect(
			page.getByRole("row", { name: new RegExp(CORRELATION_RULE_NAME) }),
		).toBeVisible();
		await page.waitForLoadState("networkidle");
		await shot("rules-default");

		await setTheme("dark");
		await expect(
			page.getByRole("row", { name: new RegExp(CORRELATION_RULE_NAME) }),
		).toBeVisible();
		await page.waitForLoadState("networkidle");
		await shot("rules-dark");

		// Error: the server's duplicate-name CONFLICT, rendered in the dialog.
		await setTheme("light");
		await createCorrelationRuleExpectingConflict(page);
		await shot("rules-error");

		// MappingRulesTab design evidence (#452): populated table with Health badge + banner
		await page.goto("/rules?tab=mapping");
		await expect(page.getByRole("heading", { name: "Rules" })).toBeVisible({
			timeout: 15_000,
		});
		await setTheme("light");

		await createMappingRule(page);
		const mappingRow = page.getByRole("row", {
			name: new RegExp(MAPPING_RULE_NAME),
		});
		await expect(mappingRow).toBeVisible();
		await expect(mappingRow.getByText("Never matched")).toBeVisible();
		await expect(page.getByTestId("unmapped-services-banner")).toBeVisible();
		await page.waitForLoadState("networkidle");
		await shot("mapping-rules-tab-default");

		await setTheme("dark");
		await expect(mappingRow).toBeVisible();
		await expect(mappingRow.getByText("Never matched")).toBeVisible();
		await expect(page.getByTestId("unmapped-services-banner")).toBeVisible();
		await page.waitForLoadState("networkidle");
		await shot("mapping-rules-tab-dark");

		// Error: mapping-rules query failure renders destructive alert with Retry button
		await setTheme("light");
		await page.route(
			(url) => url.pathname === "/api/alert-mapping/rules",
			(route) =>
				route.fulfill({
					status: 500,
					contentType: "application/json",
					body: JSON.stringify({ message: "Failed to load mapping rules" }),
				}),
		);
		await page.reload();
		await expect(
			page.getByRole("button", { name: "Retry" }),
		).toBeVisible({ timeout: 15_000 });
		await page.waitForLoadState("networkidle");
		await shot("mapping-rules-tab-error");
		await page.unrouteAll({ behavior: "ignoreErrors" });

		await deleteRulesCreatedByThisSpec(page);
	});
});
