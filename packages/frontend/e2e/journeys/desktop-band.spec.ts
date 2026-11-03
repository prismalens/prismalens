// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import { hideQueryDevtools } from "./live-stream-fixtures";

/**
 * #1020: in the desktop window the sidebar's brand row and the page header are
 * the title row. They drag the window, their controls do not, and nothing a
 * person can click sits under the window controls. The preload bridge is faked,
 * which is all `data-desktop` keys on; Chromium has no window-controls overlay
 * here, so the controls' box is the fallback in tokens.css.
 */
const INCIDENT_ID = "b0111111-1111-4111-8111-111111111111";
/** TITLEBAR_HEIGHT in packages/desktop/src/chrome.ts, and `--header-h`. */
const ROW_H = 44;
/** tokens.css's fallback widths: the overlay controls off macOS, the traffic lights on it. */
const CONTROLS = {
	win32: { left: 0, right: 138 },
	darwin: { left: 80, right: 0 },
};

const region = (el: Element) =>
	getComputedStyle(el).getPropertyValue("-webkit-app-region");

async function open(page: Page, path: string, platform?: "win32" | "darwin") {
	await hideQueryDevtools(page);
	if (platform)
		await page.addInitScript((p) => {
			window.prismalensDesktop = { platform: p, setTheme: () => {} };
		}, platform);
	await page.goto(path);
	const header = page
		.locator('[data-testid="incident-header"], [data-testid="page-header"]')
		.first();
	await expect(header).toBeVisible({ timeout: 15_000 });
	return header;
}

/** Everything a person can click or focus whose box meets the window controls. */
function underControls(page: Page, box: { left: number; right: number }) {
	return page.evaluate(
		({ h, box }) => {
			const w = window.innerWidth;
			const hits: string[] = [];
			const all = document.querySelectorAll<HTMLElement>(
				"a, button, input, select, textarea, [tabindex]",
			);
			for (const el of Array.from(all)) {
				const r = el.getBoundingClientRect();
				if (r.width === 0 || r.height === 0 || r.top >= h) continue;
				if (!el.checkVisibility({ visibilityProperty: true })) continue;
				if (r.left < box.left || r.right > w - box.right)
					hits.push(el.outerHTML.slice(0, 80));
			}
			return hits;
		},
		{ h: ROW_H, box },
	);
}

// The desktop window's minWidth is 800 (packages/desktop/src/main.ts).
for (const width of [800, 1024, 1440]) {
	for (const path of [`/incidents/${INCIDENT_ID}`, "/incidents"]) {
		test(`the title row sits above ${path} at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 800 });
			const header = await open(page, path, "win32");

			// No empty strip: the header and the sidebar start at the window's top.
			await expect(page.getByTestId("drag-row")).toHaveCount(0);
			expect((await header.boundingBox())?.y).toBe(0);
			expect((await page.getByTestId("sidebar").boundingBox())?.y).toBe(0);

			// The rows drag the window; the controls in them stay clickable.
			const brand = page.getByTestId("sidebar").locator("[data-title-row]");
			expect(await brand.evaluate(region)).toBe("drag");
			expect(await header.evaluate(region)).toBe("drag");
			const control = header.locator("a, button").first();
			expect(await control.evaluate(region)).toBe("no-drag");

			await expect.poll(() => underControls(page, CONTROLS.win32)).toEqual([]);
		});
	}
}

test("macOS's traffic lights cover nothing on the brand row or the header", async ({
	page,
}) => {
	for (const width of [1024, 1440]) {
		await page.setViewportSize({ width, height: 800 });
		await open(page, `/incidents/${INCIDENT_ID}`, "darwin");
		await expect.poll(() => underControls(page, CONTROLS.darwin)).toEqual([]);
	}
});

test("the browser has no title row", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	const header = await open(page, `/incidents/${INCIDENT_ID}`);
	expect((await header.boundingBox())?.y).toBe(0);
	expect(await header.evaluate(region)).not.toBe("drag");
	await expect(page.locator("[data-edge-right], [data-edge-left]")).toHaveCount(
		0,
	);
});
