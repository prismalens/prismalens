// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import { setTheme } from "./live-stream-fixtures";

/**
 * #523 S2/final, #811 — the shell's keyboard surface. The sidebar is a
 * thread list now (#1020); thread-list.spec.ts covers its rows.
 */
test.use({ viewport: { width: 1440, height: 900 } });

function headerHeading(page: Page) {
	return page
		.getByTestId("page-header")
		.getByRole("heading", { name: "Incidents", exact: true });
}

test.describe("#523 S2/final — the incidents queue and the shell keys", () => {
	test("grouping and the keyboard surface", async ({ page }) => {
		await page.goto("/incidents?view=analytics");
		await expect(headerHeading(page)).toBeVisible({ timeout: 15_000 });
		await setTheme(page, "light");
		// The reload draws the sidebar before the layout's key listener is attached.
		await expect(headerHeading(page)).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("thread-list")).toBeVisible();

		// `?` opens the shortcut sheet.
		await page.keyboard.press("?");
		await expect(page.getByTestId("shortcut-sheet")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("shortcut-sheet")).toHaveCount(0);

		// `[` hides the sidebar, leaving a show button, and brings it back (#848).
		const sidebar = page.getByTestId("sidebar");
		await expect(sidebar).toBeVisible();
		const width = async () => (await sidebar.boundingBox())?.width;
		expect(await width()).toBe(240);
		await page.keyboard.press("[");
		await expect(sidebar).toHaveCount(0);
		await expect(page.getByTestId("sidebar-show")).toBeVisible();
		await page.keyboard.press("[");
		await expect.poll(width).toBe(240);
		await expect(sidebar.getByTestId("sidebar-search")).toBeVisible();

		// `g` then `a` goes to the alerts front door.
		await page.keyboard.press("g");
		await page.keyboard.press("a");
		await expect(page).toHaveURL(/\/alerts(\/|\?|$)/);
	});

	test("All incidents keeps a 90-day range from Analytics (#673 w6-35)", async ({
		page,
	}) => {
		const from = new Date(Date.now() - 90 * 86_400_000).toISOString();
		await page.goto(`/incidents?view=all&from=${encodeURIComponent(from)}`);
		await expect(page.getByTestId("board-window")).toHaveText("90 days", {
			timeout: 15_000,
		});
	});

	test("empty — a date window with nothing in it", async ({ page }) => {
		const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
		await page.goto(`/incidents?view=all&from=${encodeURIComponent(tomorrow)}`);
		await expect(page.getByTestId("all-empty")).toBeVisible({
			timeout: 15_000,
		});
		await setTheme(page, "light");
		await expect(page.getByTestId("all-empty")).toBeVisible();
	});
});
