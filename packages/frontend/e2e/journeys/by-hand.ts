// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";

/**
 * An incident made by hand (#1020): New thread with Incident on and /note,
 * so no run starts. The first line is the title, the rest the description.
 */
export async function createIncidentByHand(
	page: Page,
	title: string,
	opts: { description?: string; service?: string } = {},
): Promise<void> {
	await page.goto("/threads/new?incident=true&note=true");
	await expect(page.getByTestId("composer-note")).toBeVisible({
		timeout: 15_000,
	});
	if (opts.service) {
		await page.getByTestId("composer-subject").click();
		await page.getByRole("option", { name: opts.service, exact: true }).click();
	}
	const box = page.getByTestId("composer-input");
	await box.fill(opts.description ? `${title}\n${opts.description}` : title);
	await box.press("Enter");
	await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/, {
		timeout: 15_000,
	});
}
