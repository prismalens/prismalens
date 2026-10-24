// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";

test.describe("C2 — Integrations, connections & system settings journey", () => {
	test("navigates settings tabs and integration configuration form", async ({
		page,
	}) => {
		// 1. Navigate to /settings; git hosts live in Sources (#848)
		await page.goto("/settings");
		await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("settings-nav-sources")).toBeVisible({
			timeout: 15_000,
		});

		// Sources holds git hosts; a token is added in three steps (#848).
		await page.getByTestId("settings-nav-sources").click();
		await page.getByTestId("sources-add").click();
		const dialog = page.getByRole("dialog", { name: "Add a source" });
		await dialog.getByTestId("source-kind-github").click();
		await dialog.getByRole("button", { name: "Next" }).click();
		await expect(dialog.getByTestId("source-credential-kind")).toHaveCount(0);
		await dialog.getByTestId("source-test").click();
		await expect(dialog.getByTestId("source-url")).toHaveAccessibleDescription(
			"Enter an address that starts with http:// or https://",
		);
		await page.keyboard.press("Escape");
		await expect(dialog).toHaveCount(0);
		await page.getByTestId("settings-nav-alert-intake").click();
		await expect(
			page.getByRole("heading", { name: "Webhook", level: 3 }),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("webhook-url")).toContainText(
			"/api/webhooks/prometheus",
		);
	});
});
