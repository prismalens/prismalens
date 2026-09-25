// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import { setTheme, SHOTS } from "./live-stream-fixtures";

const shot = (page: Page, name: string) =>
	page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

test.describe("#523 — the settings frame", () => {
	test("pane sections with status lines, agent picker and model pill, services inside frame", async ({
		page,
	}) => {
		await page.goto("/settings");
		await expect(page.getByTestId("settings-frame")).toBeVisible({
			timeout: 15_000,
		});

		const pane = page.getByTestId("settings-pane");
		await expect(pane).toBeVisible();

		// 1. Pane sections with their labels and status lines
		const harnessNav = page.getByTestId("settings-nav-harness");
		await expect(harnessNav).toBeVisible();
		await expect(harnessNav).toContainText("Agent");

		const integrationsNav = page.getByTestId("settings-nav-integrations");
		await expect(integrationsNav).toBeVisible();
		await expect(integrationsNav).toContainText("Integrations");

		const connectionsNav = page.getByTestId("settings-nav-connections");
		await expect(connectionsNav).toBeVisible();
		await expect(connectionsNav).toContainText("Connections");

		const servicesNav = page.getByTestId("settings-nav-services");
		await expect(servicesNav).toBeVisible();
		await expect(servicesNav).toContainText("Services");
		await expect(servicesNav).toContainText("what a run may read");

		const usageNav = page.getByTestId("settings-nav-usage");
		await expect(usageNav).toBeVisible();
		await expect(usageNav).toContainText("Usage data");
		await expect(usageNav).toContainText("usage counts");

		await expect(page.getByTestId("settings-nav-about")).toContainText(/version|available/);

		const dangerNav = page.getByTestId("settings-nav-danger");
		await expect(dangerNav).toBeVisible();
		await expect(dangerNav).toContainText("Danger zone");
		await expect(dangerNav).toContainText("reset");

		// Screenshots: default (light) and dark
		await setTheme(page, "light");
		await expect(page.getByTestId("settings-frame")).toBeVisible();
		await page.waitForTimeout(500);
		await shot(page, "settings-frame-default");

		await setTheme(page, "dark");
		await expect(page.getByTestId("settings-frame")).toBeVisible();
		await page.waitForTimeout(500);
		await shot(page, "settings-frame-dark");

		// 2. Agent picker choose and model pill set
		await page.goto("/settings?tab=harness");
		await expect(page.getByTestId("harness-settings")).toBeVisible({
			timeout: 15_000,
		});

		const picker = page.getByTestId("agent-picker");
		await expect(picker).toBeVisible();
		await picker.click();

		const pickerList = page.getByTestId("agent-picker-list");
		await expect(pickerList).toBeVisible();
		// Choose auto or opencode
		const autoOption = page.getByTestId("agent-option-auto");
		await expect(autoOption).toBeVisible();
		await autoOption.click();
		await expect(pickerList).toHaveCount(0);

		// Model pill
		const modelPill = page.getByTestId("model-pill");
		if (await modelPill.isEnabled()) {
			await modelPill.click();
			const modelInput = page.getByLabel("Model", { exact: true });
			await expect(modelInput).toBeVisible();
			await modelInput.fill("gpt-4o-mini");
			await page.getByRole("button", { name: "Use", exact: true }).click();
			await expect(modelInput).toHaveCount(0);
			await expect(modelPill).toContainText("gpt-4o-mini");
		}

		// 3. Services lives inside the settings frame
		await servicesNav.click();
		await expect(page).toHaveURL(/\/services/);
		await expect(page.getByTestId("settings-frame")).toBeVisible();
		await expect(page.getByTestId("settings-pane")).toBeVisible();
		await expect(servicesNav).toHaveAttribute("aria-current", "page");

		// Open a service detail - it stays inside settings frame
		const serviceLink = page.locator("table tbody tr a").first();
		if (await serviceLink.isVisible()) {
			await serviceLink.click();
			await expect(page).toHaveURL(/\/services\/[0-9a-f-]{36}/);
			await expect(page.getByTestId("settings-frame")).toBeVisible();
			await expect(page.getByTestId("settings-pane")).toBeVisible();

			// Tabs are role="tab" buttons
			const tabs = page.getByRole("tab");
			await expect(tabs.filter({ hasText: "Overview" })).toBeVisible();
			await expect(tabs.filter({ hasText: "Repositories" })).toBeVisible();
		}
	});
});
