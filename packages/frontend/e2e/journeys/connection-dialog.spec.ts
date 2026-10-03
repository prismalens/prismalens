// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";

test.describe("Add connection dialog (walk f13, #776 review)", () => {
	test("picking a provider keeps it open; a backdrop click closes it", async ({
		page,
	}) => {
		// The dialog opens from an integration row's "Connect an account", so seed one.
		const templates = (await (
			await page.request.get("/api/integrations/templates")
		).json()) as { id: string }[];
		const template =
			templates.find((t) => t.id === "github") ??
			templates.find((t) => t.id !== "alertmanager" && t.id !== "prometheus");
		expect(template).toBeDefined();
		const created = await page.request.post("/api/integrations", {
			data: { templateId: template?.id, label: "Dialog check" },
		});
		expect(created.ok()).toBe(true);
		const { id } = (await created.json()) as { id: string };

		try {
			await page.goto("/settings?tab=integrations");
			await page
				.getByTestId("integration-row")
				.filter({ hasText: "Dialog check" })
				.getByRole("button", { name: "Connect an account" })
				.click();
			const dialog = page.getByRole("dialog", { name: "Add connection" });
			await expect(dialog).toBeVisible({ timeout: 15_000 });

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
