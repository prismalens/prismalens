// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";

test.describe("#1024 — the release channel on About", () => {
	// The channel lives in the shared workspace; later scenarios expect stable.
	test.afterEach(async ({ page }) => {
		await page.request.put("/api/settings/update", {
			data: { channel: "stable" },
		});
	});

	test("choosing Nightly saves it, and it is still chosen after a reload", async ({
		page,
	}) => {
		await page.goto("/settings?tab=about");
		const channel = page.getByTestId("about-release-channel");
		await expect(channel).toHaveText("Stable", { timeout: 15_000 });

		await channel.click();
		await page.getByRole("option", { name: "Nightly" }).click();
		await expect(channel).toHaveText("Nightly");
		await expect(page.getByTestId("about-updates")).toContainText(
			"A build of main each night its checks pass. pl upgrade follows it too",
		);

		await page.reload();
		await expect(page.getByTestId("about-release-channel")).toHaveText(
			"Nightly",
			{ timeout: 15_000 },
		);
	});
});
