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
			["sources", "Alert sources"],
			["integrations", "Integrations"],
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
		// The rail opens on the agent the next run uses; Agent default saves at
		// once and closes the picker.
		const def = pickerList.getByTestId("model-default");
		if ((await def.count()) > 0) {
			await def.click();
			await expect(pickerList).toHaveCount(0);
			await expect(page.getByTestId("model-pill")).toHaveText("Agent default");
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
		await expect(page.getByTestId("services-page")).toBeVisible();

		// A service is one page, with no tabs (services.feature).
		await page.getByTestId("service-row-link").first().click();
		await expect(page).toHaveURL(/\/services\/[0-9a-f-]{36}/);
		await expect(page.getByTestId("service-page")).toBeVisible();
		await expect(page.getByRole("tab")).toHaveCount(0);
	});
});
