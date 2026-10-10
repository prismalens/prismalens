// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";
import { hideQueryDevtools } from "./live-stream-fixtures";

/**
 * #752, #811: in the desktop window an open incident's overview header is the title strip.
 * The preload bridge is faked, which is all `data-desktop` keys on; the drag regions
 * are read as the computed `-webkit-app-region` Electron honours.
 */
const INCIDENT_ID = "b0111111-1111-4111-8111-111111111111";
/** The Windows/Linux window-control overlay the header must stay clear of (#811 WindowControlsSpace: 132px). */
const CONTROLS_W = 132;

// The desktop window's minWidth is 800 (packages/desktop/src/main.ts).
for (const width of [800, 1024, 1440]) {
	test(`the overview header fills the desktop title strip at ${width}px`, async ({
		page,
	}) => {
		await hideQueryDevtools(page);
		await page.addInitScript(() => {
			window.prismalensDesktop = { platform: "win32", setTheme: () => {} };
		});
		await page.setViewportSize({ width, height: 800 });
		await page.goto(`/incidents/${INCIDENT_ID}`);

		const header = page.getByTestId("incident-header");
		await expect(header).toBeVisible({ timeout: 15_000 });
		const box = await header.boundingBox();
		expect(box?.y).toBe(0);
		expect(box?.height).toBe(44);

		const region = (el: Element) =>
			getComputedStyle(el).getPropertyValue("-webkit-app-region");
		expect(await header.evaluate(region)).toBe("drag");

		const controls = header.locator("a, button");
		const n = await controls.count();
		expect(n).toBeGreaterThan(0);
		for (let i = 0; i < n; i++) {
			const control = controls.nth(i);
			if (!(await control.isVisible())) continue;
			expect(await control.evaluate(region)).toBe("no-drag");
			const c = await control.boundingBox();
			// Nothing sits under the window controls on the header's first row.
			if (c && c.y < 40)
				expect(c.x + c.width).toBeLessThanOrEqual(width - CONTROLS_W);
			// And what is painted there is the control itself, not the strip over it.
			if (c) {
				const point = await control.evaluate((el) => {
					const rect = el.getBoundingClientRect();
					let parent = el.parentElement;
					let right = rect.right;
					while (parent) {
						const style = getComputedStyle(parent);
						if (style.overflow === "hidden" || style.overflowX === "hidden") {
							right = Math.min(right, parent.getBoundingClientRect().right);
						}
						parent = parent.parentElement;
					}
					const visibleWidth = Math.max(1, right - rect.left);
					return [rect.left + visibleWidth / 2, rect.top + rect.height / 2];
				});
				const hit = await page.evaluate(
					([x, y]) =>
						!!document
							.elementFromPoint(x, y)
							?.closest('[data-testid="incident-header"] :is(a, button)'),
					point,
				);
				expect(hit).toBe(true);
			}
		}
	});
}
