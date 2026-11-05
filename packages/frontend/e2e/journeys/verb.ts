// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Picks what the box's Send does (#1020): the current action reads above the box
 * and the others are under `/`. The typed text is kept across the pick.
 */
export async function pickAction(
	scope: Page | Locator,
	id: string,
): Promise<void> {
	const mode = scope.getByTestId("composer-mode");
	await mode.waitFor({ timeout: 15_000 });
	if ((await mode.getAttribute("data-mode")) === id) return;
	const input = scope.getByTestId("composer-input");
	const kept = await input.inputValue();
	await input.fill("/");
	await scope.getByTestId(`composer-slash-${id}`).click();
	await expect(mode).toHaveAttribute("data-mode", id);
	if (kept) await input.fill(kept);
}

/**
 * A draft's Investigate button. A draft on an incident with no alerts, or
 * with a report already, opens on Ask (#673 w59), so the action is picked first.
 */
export async function investigateButton(page: Page): Promise<Locator> {
	await page.getByTestId("composer-input").waitFor({ timeout: 15_000 });
	const mode = page.getByTestId("composer-mode");
	// A blocked box takes no text, so there is nothing to pick until it opens.
	const open = await page.getByTestId("composer-input").isEnabled();
	if (open && (await mode.count())) await pickAction(page, "investigate");
	return page.getByTestId("composer-send");
}
