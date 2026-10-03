// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";

test.describe("Add connection dialog (walk f13, #776 review)", () => {
	test("picking a provider keeps it open; a backdrop click closes it", async ({
		page,
	}) => {
		await page.goto("/settings");
		await page.getByTestId("settings-nav-connections").click();
		await page.getByRole("button", { name: "Add connection" }).first().click();
		const dialog = page.getByRole("dialog", { name: "Add connection" });
		await expect(dialog).toBeVisible({ timeout: 15_000 });

		await dialog.getByRole("combobox").click();
		await page.getByRole("option", { name: /Alertmanager/ }).click();
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole("combobox")).toContainText("Alertmanager");

		await page.mouse.click(5, 5);
		await expect(dialog).toBeHidden();
	});
});
