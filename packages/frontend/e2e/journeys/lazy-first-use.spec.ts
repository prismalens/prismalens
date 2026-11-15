// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import { createIncidentByHand } from "./by-hand";

/**
 * Proof run (#1101 category 12): a menu, a popover and a dialog load their Radix half on first
 * use. Their chunks are held back here, so each press lands before the code; it must still open.
 */
const HELD =
	/\/assets\/(MenuImpl|PopoverImpl|PickerList|dialog-impl|ShortcutSheet|SurfaceMenus)-[^/]+\.js$/;

async function holdLazyHalves(page: Page) {
	await page.route(HELD, async (route) => {
		await new Promise((r) => setTimeout(r, 2_000));
		await route.continue();
	});
}

test("the subject picker opens on a press made before its code arrives", async ({
	page,
}) => {
	await holdLazyHalves(page);
	await page.goto("/new");
	const subject = page.getByTestId("composer-subject");
	await expect(subject).toBeVisible({ timeout: 30_000 });
	await subject.click();
	await expect(
		page.locator('[data-testid^="picker-option-"]').first(),
	).toBeVisible({ timeout: 15_000 });
});

test("the shortcut sheet opens on ? pressed before its code arrives", async ({
	page,
}) => {
	await holdLazyHalves(page);
	await page.goto("/new");
	await expect(page.getByTestId("new-thread-page")).toBeVisible({
		timeout: 30_000,
	});
	// Home focuses its box; the sheet's key is for the page.
	await page.getByRole("heading", { name: "What should we work on?" }).click();
	await page.keyboard.press("Shift+Slash");
	await expect(page.getByTestId("shortcut-sheet")).toBeVisible({
		timeout: 15_000,
	});
});

test("the incident's menu opens on a press made before its code arrives", async ({
	page,
}) => {
	await createIncidentByHand(page, "Checkout fails on retry");
	const at = page.url();
	await holdLazyHalves(page);
	await page.goto(at);
	const more = page.getByTestId("header-more");
	await expect(more).toBeVisible({ timeout: 30_000 });
	await more.click();
	await expect(page.getByRole("menu")).toBeVisible({ timeout: 15_000 });
});

test.describe("on a phone", () => {
	test.use({ viewport: { width: 390, height: 844 } });
	test("the sidebar drawer opens on a press made before its code arrives", async ({
		page,
	}) => {
		await holdLazyHalves(page);
		await page.goto("/new");
		const menu = page.getByRole("button", { name: "Menu" });
		await expect(menu).toBeVisible({ timeout: 30_000 });
		await menu.click();
		await expect(page.getByTestId("phone-menu")).toBeVisible({
			timeout: 15_000,
		});
	});
});
