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
		await expect(page.getByTestId("settings-nav-integrations")).toBeVisible({
			timeout: 15_000,
		});

		// Integrations holds git hosts and delivery; the webhook moved to Alert sources.
		await page.getByTestId("settings-nav-integrations").click();
		await expect(
			page.getByRole("heading", { name: "Git hosts", level: 3 }),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("add-integration")).toHaveText("Add a token");
		// Each field's control is described by its hint, then by its error.
		await page.getByTestId("add-integration").click();
		const dialog = page.getByRole("dialog", { name: "Add a git host token" });
		const host = dialog.locator("#cred-host");
		await expect(host).toHaveValue("github.com");
		await expect(host).toHaveAccessibleDescription(
			"github.com, gitlab.com, bitbucket.org, or your own git host, with :port if it has one",
		);
		const token = dialog.locator("#cred-token");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(token).toHaveAccessibleDescription("Token is required");
		await page.keyboard.press("Escape");
		await expect(dialog).toHaveCount(0);
		await page.getByTestId("settings-nav-sources").click();
		await expect(
			page.getByRole("heading", { name: "Webhook", level: 3 }),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("webhook-url")).toContainText(
			"/api/webhooks/prometheus",
		);
	});
});
