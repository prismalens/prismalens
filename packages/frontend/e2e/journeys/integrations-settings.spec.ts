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
			page.getByRole("button", { name: "Integrations" }),
		).toBeVisible({ timeout: 15_000 });

		// Switch to Integrations tab
		await page.getByRole("button", { name: "Integrations" }).click();
		await expect(page.getByText("Webhook URLs")).toBeVisible({
			timeout: 15_000,
		});
		await expect(
			page.getByRole("button", { name: "Add Integration" }).first(),
		).toBeVisible({ timeout: 15_000 });

		// 2. Navigate to /settings/integrations/configure and assert configuration page/form renders
		await page.goto("/settings/integrations/configure");
		await expect(
			page.getByText(/Configure|Select Installation|Missing Connection ID/),
		).toBeVisible({ timeout: 15_000 });
	});
});
