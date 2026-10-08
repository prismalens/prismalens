// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Locator, type Page } from "@playwright/test";

/**
 * A draft's Investigate button. A draft on an incident with no alerts, or
 * with a report already, opens on Ask (#673 w59), so the verb is picked first.
 */
export async function investigateButton(page: Page): Promise<Locator> {
	const chip = page.getByTestId("verb-chip");
	await chip.waitFor({ timeout: 15_000 });
	if ((await chip.getAttribute("data-verb")) !== "investigate") {
		// A menu that just closed can swallow the first click; retry until the popover opens.
		await expect(async () => {
			if (!(await page.getByTestId("verb-menu").isVisible()))
				await chip.click();
			await expect(page.getByTestId("verb-menu")).toBeVisible({
				timeout: 1_000,
			});
		}).toPass({ timeout: 10_000 });
		// The popover can still be settling; the option is pressed, not hunted for.
		await page.getByTestId("verb-investigate").dispatchEvent("click");
		await expect(chip).toHaveAttribute("data-verb", "investigate");
	}
	return page.getByTestId("composer-investigate");
}
