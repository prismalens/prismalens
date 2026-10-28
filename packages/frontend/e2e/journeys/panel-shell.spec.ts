// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import {
	hideQueryDevtools,
	INVESTIGATION_ID,
	serveInvestigationAs,
} from "./live-stream-fixtures";

// The shared panel layout (#973): the page, a right panel beside it, a frame that never scrolls.
const INCIDENT_ID = "b0111111-1111-4111-8111-111111111111";
const RUN_URL = `/incidents/${INCIDENT_ID}/conversation?investigation=${INVESTIGATION_ID}`;

async function openRun(page: Page, width: number, height = 800) {
	await page.setViewportSize({ width, height });
	await hideQueryDevtools(page);
	await serveInvestigationAs(page, INVESTIGATION_ID, { status: "completed" });
	await page.goto(RUN_URL);
	await expect(page.getByTestId("run-page")).toBeVisible({ timeout: 15_000 });
}

// The panel's own scroller reaches its last line at every width (OBJ-009).
async function lastLineReachable(page: Page) {
	const summary = page.getByTestId("run-details-summary");
	await summary.evaluate((el) => {
		el.scrollTop = el.scrollHeight;
	});
	await expect(summary.locator(":scope > *").last()).toBeInViewport();
}

async function frameDoesNotScroll(page: Page) {
	const { scroll, inner } = await page.evaluate(() => ({
		scroll: document.documentElement.scrollHeight,
		inner: window.innerHeight,
	}));
	expect(scroll).toBeLessThanOrEqual(inner);
}

test.describe("Shared panel layout (#973)", () => {
	test("1280 px: details sit beside the run, resize by keyboard, and keep size and open state across a reload", async ({
		page,
	}) => {
		await openRun(page, 1280);
		await page.getByTestId("details-toggle").click();
		const panel = page.getByTestId("panel-right");
		await expect(panel.getByTestId("run-details")).toBeVisible();
		await frameDoesNotScroll(page);
		await lastLineReachable(page);

		const route = await page.getByTestId("shell-route").boundingBox();
		const box = await panel.boundingBox();
		expect(route && box).toBeTruthy();
		if (!route || !box) return;
		expect(route.x + route.width).toBeLessThanOrEqual(box.x + 1);

		const sep = page.getByTestId("panel-right-separator");
		await expect(sep).toHaveAttribute("role", "separator");
		await sep.focus();
		for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
		const wider = await panel.boundingBox();
		expect(wider?.width ?? 0).toBeGreaterThan(box.width + 20);

		// The library debounces its save; give it a moment before reloading.
		await page.waitForTimeout(400);
		await page.reload();
		await expect(panel.getByTestId("run-details")).toBeVisible({
			timeout: 15_000,
		});
		const after = await panel.boundingBox();
		expect(Math.abs((after?.width ?? 0) - (wider?.width ?? 0))).toBeLessThan(3);

		await page.getByTestId("run-details-close").click();
		await expect(panel).toHaveCount(0);
		await expect(page.getByTestId("details-toggle")).toBeFocused();
		await page.reload();
		await expect(page.getByTestId("run-page")).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("panel-right")).toHaveCount(0);
	});

	test("900 px: details float over the run, take focus, and Escape returns it", async ({
		page,
	}) => {
		await openRun(page, 900);
		await page.getByTestId("details-toggle").click();
		const panel = page.getByTestId("panel-right");
		await expect(panel).toHaveAttribute("role", "dialog");
		await expect(panel).toHaveAttribute("aria-modal", "false");
		await expect(page.locator("[role=separator]")).toHaveCount(0);
		await frameDoesNotScroll(page);
		await lastLineReachable(page);
		await page.keyboard.press("Escape");
		await expect(panel).toHaveCount(0);
		await expect(page.getByTestId("details-toggle")).toBeFocused();
	});

	test("390 px: details are a full-screen sheet over an inert run", async ({
		page,
	}) => {
		await openRun(page, 390, 844);
		await page.getByTestId("details-toggle").click();
		const sheet = page.getByTestId("panel-right");
		await expect(sheet).toHaveAttribute("aria-modal", "true");
		const box = await sheet.boundingBox();
		expect(box?.width).toBe(390);
		expect(box?.height).toBe(844);
		await expect(page.getByTestId("shell-route")).toHaveAttribute("inert", "");
		await lastLineReachable(page);
		await page.getByTestId("run-details-close").click();
		await expect(sheet).toHaveCount(0);
		await expect(page.getByTestId("shell-route")).not.toHaveAttribute(
			"inert",
			"",
		);
	});

	for (const path of ["/incidents", "/alerts", "/services", "/settings"]) {
		test(`${path} still fills the frame without scrolling the page`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			await hideQueryDevtools(page);
			await page.goto(path);
			await expect(page.getByTestId("shell-frame")).toBeVisible({
				timeout: 15_000,
			});
			await frameDoesNotScroll(page);
		});
	}
});
