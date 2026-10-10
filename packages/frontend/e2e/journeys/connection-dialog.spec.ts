// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";

test.describe("Add connection dialog (walk f13, #776 review)", () => {
	test("picking a provider keeps it open; a backdrop click closes it", async ({
		page,
	}) => {
		// The dialog opens from a git host token row's "Add a token", so seed one.
		const created = await page.request.post("/api/integrations", {
			data: { templateId: "git-host-token", label: "Dialog check" },
		});
		expect(created.ok()).toBe(true);
		const { id } = (await created.json()) as { id: string };

		try {
			await page.goto("/settings?tab=integrations");
			await page
				.getByTestId("integration-row")
				.filter({ hasText: "Dialog check" })
				.getByRole("button", { name: "Add a token" })
				.click();
			const dialog = page.getByRole("dialog", { name: "Add connection" });
			await expect(dialog).toBeVisible({ timeout: 15_000 });
			// The row's own integration comes preselected (#781 review).
			await expect(dialog.getByRole("combobox")).toContainText("Dialog check");

			await dialog.getByRole("combobox").click();
			await page.getByRole("option", { name: /Alertmanager/ }).click();
			await expect(dialog).toBeVisible();
			await expect(dialog.getByRole("combobox")).toContainText("Alertmanager");

			await page.mouse.click(5, 5);
			await expect(dialog).toBeHidden();
		} finally {
			await page.request.delete(`/api/integrations/${id}`);
		}
	});
});
