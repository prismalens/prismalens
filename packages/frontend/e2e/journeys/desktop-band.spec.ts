// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";
import { hideQueryDevtools } from "./live-stream-fixtures";

/**
 * #819: in the desktop window an empty, draggable title row holds the window
 * controls, and every page starts below it. The preload bridge is faked, which
 * is all `data-desktop` keys on; drag regions are read as the computed
 * `-webkit-app-region` Electron honours.
 */
const INCIDENT_ID = "b0111111-1111-4111-8111-111111111111";
/** TITLEBAR_HEIGHT in packages/desktop/src/chrome.ts. */
const ROW_H = 32;

const region = (el: Element) =>
	getComputedStyle(el).getPropertyValue("-webkit-app-region");

// The desktop window's minWidth is 800 (packages/desktop/src/main.ts).
for (const width of [800, 1024, 1440]) {
	for (const path of [`/incidents/${INCIDENT_ID}`, "/incidents"]) {
		test(`the title row sits above ${path} at ${width}px`, async ({ page }) => {
			await hideQueryDevtools(page);
			await page.addInitScript(() => {
				window.prismalensDesktop = { platform: "win32", setTheme: () => {} };
			});
			await page.setViewportSize({ width, height: 800 });
			await page.goto(path);

			const header = page
				.locator('[data-testid="incident-header"], [data-testid="page-header"]')
				.first();
			await expect(header).toBeVisible({ timeout: 15_000 });

			const row = page.getByTestId("title-row");
			expect(await row.boundingBox()).toEqual({
				x: 0,
				y: 0,
				width,
				height: ROW_H,
			});
			expect(await row.evaluate(region)).toBe("drag");

			expect((await header.boundingBox())?.y).toBe(ROW_H);
			expect(await header.evaluate(region)).not.toBe("drag");
			expect((await page.getByTestId("sidebar").boundingBox())?.y).toBe(ROW_H);

			// Nothing a person can click or focus is painted inside the row.
			const inRow = await page.evaluate((h) => {
				const hits: string[] = [];
				const all = document.querySelectorAll<HTMLElement>(
					"a, button, input, select, textarea, [tabindex]",
				);
				for (const el of Array.from(all)) {
					const r = el.getBoundingClientRect();
					if (r.width === 0 || r.height === 0) continue;
					if (r.top < h) hits.push(el.outerHTML.slice(0, 80));
				}
				return hits;
			}, ROW_H);
			expect(inRow).toEqual([]);
		});
	}
}

test("the browser has no title row", async ({ page }) => {
	await hideQueryDevtools(page);
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto(`/incidents/${INCIDENT_ID}`);
	const header = page.getByTestId("incident-header");
	await expect(header).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId("title-row")).toBeHidden();
	expect((await header.boundingBox())?.y).toBe(0);
});
