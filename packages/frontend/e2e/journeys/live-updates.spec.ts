// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";
import { hideQueryDevtools } from "./live-stream-fixtures";

/**
 * Walk finding f27: an incident that arrives while the board is open shows up
 * without a reload. The fallback poll is 10 s, so a card inside 5 s proves the
 * change stream delivered it.
 */
test.describe("live updates", () => {
	test.beforeEach(({ page }) => hideQueryDevtools(page));

	test("a new incident appears on the open board without a reload", async ({
		page,
	}) => {
		const title = `Arrived while watching ${Date.now()}`;
		const streamOpen = page.waitForResponse((r) =>
			r.url().includes("/api/live/changes"),
		);
		await page.goto("/incidents");
		await expect(
			page
				.getByTestId("incident-list-pane")
				.getByRole("heading", { name: "Incidents", exact: true }),
		).toBeVisible();
		await streamOpen;

		const created = await page.request.post("/api/incidents", {
			data: { title },
		});
		expect(created.ok()).toBe(true);

		await expect(page.getByText(title).first()).toBeVisible({ timeout: 5_000 });
	});
});
