// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";
import { hideQueryDevtools } from "./live-stream-fixtures";

/**
 * #752: in the desktop window an open incident's band is the title strip. The
 * preload bridge is faked, which is all `data-desktop` keys on; the drag regions
 * are read as the computed `-webkit-app-region` Electron honours.
 */
const INCIDENT_ID = "b0111111-1111-4111-8111-111111111111";
/** The Windows/Linux window-control overlay the band must stay clear of. */
const CONTROLS_W = 138;

for (const width of [375, 1024, 1440]) {
	test(`the band fills the desktop title strip at ${width}px`, async ({
		page,
	}) => {
		await hideQueryDevtools(page);
		await page.addInitScript(() => {
			window.prismalensDesktop = { platform: "win32", setTheme: () => {} };
		});
		await page.setViewportSize({ width, height: 800 });
		await page.goto(`/incidents/${INCIDENT_ID}`);

		const band = page.getByTestId("incident-state-band");
		await expect(band).toBeVisible({ timeout: 15_000 });
		const box = await band.boundingBox();
		expect(box?.y).toBe(0);
		if (width >= 640) expect(box?.height).toBe(40);

		const region = (el: Element) =>
			getComputedStyle(el).getPropertyValue("-webkit-app-region");
		expect(await band.evaluate(region)).toBe("drag");

		const controls = band.locator("a, button");
		const n = await controls.count();
		expect(n).toBeGreaterThan(0);
		for (let i = 0; i < n; i++) {
			const control = controls.nth(i);
			if (!(await control.isVisible())) continue;
			expect(await control.evaluate(region)).toBe("no-drag");
			const c = await control.boundingBox();
			// Nothing sits under the window controls on the band's first row.
			if (c && c.y < 40)
				expect(c.x + c.width).toBeLessThanOrEqual(width - CONTROLS_W);
			// And what is painted there is the control itself, not the strip over it.
			if (c) {
				const hit = await page.evaluate(
					([x, y]) =>
						!!document
							.elementFromPoint(x, y)
							?.closest('[data-testid="incident-state-band"] :is(a, button)'),
					[c.x + c.width / 2, c.y + c.height / 2],
				);
				expect(hit).toBe(true);
			}
		}
	});
}
