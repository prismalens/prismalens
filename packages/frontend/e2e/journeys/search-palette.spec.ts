// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { test } from "../steps/fixtures";
import { openBoard } from "../steps/product";

test("Ctrl+K finds a past incident by title and opens it", async ({ page }) => {
	const made = await page.request.post("/api/incidents", {
		data: { title: `Palette find me ${Date.now()}` },
	});
	expect(made.ok()).toBe(true);
	const { id, title } = (await made.json()) as { id: string; title: string };
	await openBoard(page);
	await page.keyboard.press("Control+k");
	const palette = page.getByTestId("search-palette");
	await expect(palette).toBeVisible();
	await palette.getByTestId("search-input").fill(title);
	await expect(palette.getByTestId("search-incident").first()).toContainText(
		title,
	);
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(new RegExp(`/incidents/${id}$`));
	await expect(palette).toBeHidden();
});
