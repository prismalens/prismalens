// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { Given, Then, When } from "./fixtures";
import { readableTitle, sidewaysFaults } from "./product";

let navigations = 0;

Given("the Inbox is open", async ({ page }) => {
	const liveStream = page.waitForResponse((r) =>
		r.url().includes("/api/live/changes"),
	);
	await page.goto("/incidents");
	await expect(
		page.getByRole("heading", { name: "Operations" }).first(),
	).toBeVisible();
	await liveStream;
	navigations = 0;
	page.on("framenavigated", (frame) => {
		if (frame === page.mainFrame()) navigations += 1;
	});
});

When(
	"Alertmanager fires {string}",
	async ({ alertmanager, deliverWebhook, unique }, name: string) => {
		alertmanager.fire({
			labels: { alertname: unique(name), severity: "warning" },
		});
		await deliverWebhook();
	},
);

// The fallback poll is 10 s, so 5 s proves the change stream delivered it (walk f27).
Then(
	"an incident for {string} appears within 5 seconds without a reload",
	async ({ page, unique }, name: string) => {
		// Needs you shows five rows a group and the sidebar elides titles (#811), so narrow to it.
		await page.getByTestId("incidents-filter").fill(unique(name));
		// The board reads alert names as words (D18).
		await expect(
			page.getByText(readableTitle(unique(name))).first(),
		).toBeVisible({
			timeout: 5_000,
		});
		expect(navigations).toBe(0);
	},
);

Then("the page does not scroll sideways", async ({ page }) => {
	expect(await sidewaysFaults(page)).toEqual([]);
});
