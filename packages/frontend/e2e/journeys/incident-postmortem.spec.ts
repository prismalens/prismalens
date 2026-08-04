// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";

test.describe("C3 — Postmortem & timeline journey", () => {
	test("displays incident list, detail tabs, timeline, and postmortem editor", async ({
		page,
	}) => {
		// 1. Navigate to /incidents and assert the seeded storm incident is visible
		await page.goto("/incidents");
		await expect(
			page.getByRole("heading", { name: "Incidents" }),
		).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByText(
				"[demo] Storm: High 5xx error rate on API Gateway & Auth timeout",
			),
		).toBeVisible({ timeout: 15_000 });

		// 2. Navigate to incident detail page
		await page.goto("/incidents/b0111111-1111-4111-8111-111111111111");
		await expect(page.getByText("INC-1", { exact: false })).toBeVisible({
			timeout: 15_000,
		});
		await expect(
			page.getByText("investigating", { exact: false }).first(),
		).toBeVisible({ timeout: 15_000 });

		// 3. Open Timeline tab
		await page.getByRole("tab", { name: /Timeline/ }).click();
		await expect(
			page.getByText("Timeline entries will appear", { exact: false }),
		).toBeVisible({ timeout: 15_000 });

		// 4. Open Postmortem tab
		await page.getByRole("tab", { name: "Postmortem" }).click();
		await expect(
			page.getByRole("button", { name: "Start Blank" }),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText(/Auto-populate/)).toBeVisible({
			timeout: 15_000,
		});

		// Click Start Blank to verify postmortem editor initializes
		await page.getByRole("button", { name: "Start Blank" }).click();
		await expect(
			page.getByPlaceholder("Postmortem title..."),
		).toBeVisible({ timeout: 15_000 });
	});
});
