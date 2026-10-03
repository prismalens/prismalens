// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";

test.describe("C2 — Integrations, connections & system settings journey", () => {
	test("navigates settings tabs and integration configuration form", async ({
		page,
	}) => {
		// 1. Navigate to /settings and assert Integrations tab button is visible
		await page.goto("/settings");
		await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({
			timeout: 15_000,
		});
		await expect(
			page.getByTestId("settings-nav-integrations"),
		).toBeVisible({ timeout: 15_000 });

		// Integrations holds git hosts and delivery; the webhook moved to Alert sources.
		await page.getByTestId("settings-nav-integrations").click();
		await expect(
			page.getByRole("heading", { name: "Integrations", level: 3 }),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("add-integration")).toHaveText(
			"Add an integration",
		);
		await page.getByTestId("settings-nav-sources").click();
		await expect(
			page.getByRole("heading", { name: "Webhook", level: 3 }),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("webhook-url")).toContainText(
			"/api/webhooks/prometheus",
		);

		// 2. Navigate to /settings/integrations/configure and assert configuration page/form renders
		await page.goto("/settings/integrations/configure");
		await expect(
			page.getByText(/Configure|Select installation|Missing Connection ID/),
		).toBeVisible({ timeout: 15_000 });
	});
});
