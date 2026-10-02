// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { Given, Then, When } from "./fixtures";

let navigations = 0;

Given("the incidents board is open", async ({ page }) => {
	const liveStream = page.waitForResponse((r) =>
		r.url().includes("/api/live/changes"),
	);
	await page.goto("/incidents");
	await expect(
		page.getByRole("heading", { name: "Incidents" }).first(),
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
		await expect(page.getByText(unique(name)).first()).toBeVisible({
			timeout: 5_000,
		});
		expect(navigations).toBe(0);
	},
);

Then("the page does not scroll sideways", async ({ page }) => {
	const overflow = await page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(0);
});
