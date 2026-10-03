// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";

test.describe("#523 — the settings frame", () => {
	test("Settings swaps the sidebar for its sections, the agent picker sets a model, Services is its own door", async ({
		page,
	}) => {
		await page.goto("/settings");
		await expect(page.getByTestId("settings-frame")).toBeVisible({
			timeout: 15_000,
		});

		// 1. The sidebar is the section list now, with Back above it (study-v3 §2)
		const sidebar = page.getByTestId("sidebar");
		await expect(sidebar.getByTestId("settings-back")).toBeVisible();
		await expect(sidebar.getByTestId("nav-incidents")).toHaveCount(0);
		const sections = sidebar.getByTestId("settings-sections");
		for (const [tab, label] of [
			["harness", "Agent"],
			["integrations", "Integrations"],
			["connections", "Connections"],
			["devices", "Devices"],
			["usage", "Usage data"],
			["about", "About"],
			["danger", "Danger zone"],
		]) {
			await expect(sections.getByTestId(`settings-nav-${tab}`)).toContainText(
				label,
			);
		}
		await expect(sections.getByTestId("settings-nav-harness")).toHaveAttribute(
			"aria-current",
			"page",
		);
		await expect(sections.getByTestId("settings-nav-services")).toHaveCount(0);

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
		// Choosing an agent saves at once and moves to its model column; a
		// model is picked by name, and choosing one closes the picker.
		const autoOption = page.getByTestId("agent-option-auto");
		await expect(autoOption).toBeVisible();
		await autoOption.click();
		const models = pickerList.getByRole("listbox", { name: /^Model/ });
		if ((await models.count()) > 0) {
			const firstModel = models.getByRole("option").first();
			await firstModel.click();
			await expect(pickerList).toHaveCount(0);
		} else {
			await page.keyboard.press("Escape");
			await expect(pickerList).toHaveCount(0);
		}
		await expect(page.getByTestId("model-pill")).toBeVisible();

		// 3. Back leaves Settings; Services is a door of its own (decision 1)
		await sidebar.getByTestId("settings-back").click();
		await expect(page).not.toHaveURL(/\/settings/);
		await sidebar.getByTestId("nav-services").click();
		await expect(page).toHaveURL(/\/services/);
		await expect(sidebar.getByTestId("nav-services")).toHaveAttribute(
			"aria-current",
			"page",
		);
		await expect(page.getByTestId("settings-frame")).toBeVisible();

		// Open a service detail: its tabs are role="tab" buttons
		const serviceLink = page.locator("table tbody tr a").first();
		if (await serviceLink.isVisible()) {
			await serviceLink.click();
			await expect(page).toHaveURL(/\/services\/[0-9a-f-]{36}/);
			const tabs = page.getByRole("tab");
			await expect(tabs.filter({ hasText: "Overview" })).toBeVisible();
			await expect(tabs.filter({ hasText: "Repositories" })).toBeVisible();
		}
	});
});
