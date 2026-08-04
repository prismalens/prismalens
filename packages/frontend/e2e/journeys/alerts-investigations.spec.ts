// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";

test.describe("D4 substitute — alerts triage & culprit rendering journey", () => {
	test("asserts total alert count and culprit / no-culprit investigation rendering", async ({
		page,
	}) => {
		// 1. Navigate to /alerts and assert total alerts count is 60 (#309 pagination assertion)
		await page.goto("/alerts");
		await expect(
			page.getByRole("heading", { name: "Alerts" }),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("alerts-total-count")).toHaveText("60", {
			timeout: 15_000,
		});

		// 2. Navigate to /investigations list page
		await page.goto("/investigations");
		await expect(
			page.getByRole("heading", { name: "Investigations" }),
		).toBeVisible({ timeout: 15_000 });

		// 3. Open culprit investigation (d0111111) and verify culprit fields on Analysis tab
		await page.goto("/investigations/d0111111-1111-4111-8111-111111111111");
		await expect(
			page.getByRole("tab", { name: "Analysis" }),
		).toBeVisible({ timeout: 15_000 });
		await page.getByRole("tab", { name: "Analysis" }).click();
		await expect(
			page.getByText("auth-service", { exact: false }).first(),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText("v2.4.1", { exact: true })).toBeVisible({
			timeout: 15_000,
		});
		await expect(
			page.getByText("connection-pool exhaustion", { exact: false }).first(),
		).toBeVisible({ timeout: 15_000 });

		// 4. Open no-culprit investigation (d0222222) and verify the stable
		//    no-culprit state: report renders, but absence stays absence —
		//    no service, change ref, or mechanism is invented (culprit: null
		//    in the seed, so AnalysisTab must render no Culprit section at all).
		await page.goto("/investigations/d0222222-2222-4222-8222-222222222222");
		await expect(
			page.getByRole("tab", { name: "Analysis" }),
		).toBeVisible({ timeout: 15_000 });
		await page.getByRole("tab", { name: "Analysis" }).click();
		await expect(page.getByText("Root Cause Analysis")).toBeVisible({
			timeout: 15_000,
		});
		await expect(
			page.getByText(
				"Upstream payment provider experiencing elevated processing latencies.",
			),
		).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByText("Culprit", { exact: true }),
		).not.toBeVisible();
	});
});
