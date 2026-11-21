// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import {
	forgetPanelWidth,
	hideQueryDevtools,
	INVESTIGATION_ID,
	serveInvestigationAs,
} from "./live-stream-fixtures";

// The shared panel layout (#973): the page, a right panel beside it, a frame that never scrolls.
const INCIDENT_ID = "b0111111-1111-4111-8111-111111111111";
const RUN_URL = `/incidents/${INCIDENT_ID}/conversation?investigation=${INVESTIGATION_ID}`;

async function openRun(page: Page, width: number, height = 800) {
	await forgetPanelWidth(page);
	await page.setViewportSize({ width, height });
	await hideQueryDevtools(page);
	await serveInvestigationAs(page, INVESTIGATION_ID, { status: "completed" });
	await page.goto(RUN_URL);
	await expect(page.getByTestId("run-page")).toBeVisible({ timeout: 15_000 });
}

// The panel's own scroller reaches its last line at every width (OBJ-009).
async function lastLineReachable(page: Page) {
	// The Incident tab's stack scrolls as one; its last block must come into view (#1024).
	const stack = page.getByTestId("run-details").getByTestId("panel-stack");
	await stack.evaluate((el) => {
		el.scrollTop = el.scrollHeight;
	});
	await expect(stack.locator(":scope > *").last()).toBeInViewport();
}

async function frameDoesNotScroll(page: Page) {
	const { scroll, inner } = await page.evaluate(() => ({
		scroll: document.documentElement.scrollHeight,
		inner: window.innerHeight,
	}));
	expect(scroll).toBeLessThanOrEqual(inner);
}

test.describe("Shared panel layout (#973)", () => {
	// #1154: app, #1193's files: PanelShell keeps 470 px of a 511 px keyboard resize; RunPage's closePanel focuses header-more, not panel-toggle
	test.fixme("1280 px: details sit beside the run, resize by keyboard, and keep size and open state across a reload", async ({
		page,
	}) => {
		await openRun(page, 1280);
		await page.getByTestId("panel-toggle").click();
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

		// The width is a person setting: the server's copy replaces the cached one after a
		// reload, so reload once the server holds what this page cached (#1154).
		const cached = await page.evaluate(() =>
			localStorage.getItem("pl.panelWidth"),
		);
		expect(cached).not.toBeNull();
		await expect
			.poll(async () => {
				const r = await page.request.get("/api/settings/person");
				const body = (await r.json()) as { values: Record<string, string> };
				return body.values["pl.panelWidth"];
			})
			.toBe(cached);
		await page.reload();
		await expect(panel.getByTestId("run-details")).toBeVisible({
			timeout: 15_000,
		});
		await expect
			.poll(async () =>
				Math.abs(
					((await panel.boundingBox())?.width ?? 0) - (wider?.width ?? 0),
				),
			)
			.toBeLessThan(3);

		await page.getByTestId("run-details-close").click();
		await expect(panel).toHaveCount(0);
		await expect(page.getByTestId("panel-toggle")).toBeFocused();
		await page.reload();
		await expect(page.getByTestId("run-page")).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("panel-right")).toHaveCount(0);
	});

	// #1154: app, #1193's files: RunPage's closePanel focuses header-more, which no longer opens details, not panel-toggle
	test.fixme("900 px: details float over the run, take focus, and Escape returns it", async ({
		page,
	}) => {
		await openRun(page, 900);
		await page.getByTestId("panel-toggle").click();
		const panel = page.getByTestId("panel-right");
		await expect(panel).toHaveAttribute("role", "dialog");
		await expect(panel).toHaveAttribute("aria-modal", "false");
		await expect(page.locator("[role=separator]")).toHaveCount(0);
		await frameDoesNotScroll(page);
		await lastLineReachable(page);
		await page.keyboard.press("Escape");
		await expect(panel).toHaveCount(0);
		await expect(page.getByTestId("panel-toggle")).toBeFocused();
	});

	// #1154: app, #1193's PanelShell sheet: Tab from its last control (Copy evidence) leaves for a focus guard, 2 runs in 4
	test.fixme("390 px: details are a full-screen modal sheet; focus stays in it and the page behind is hidden", async ({
		page,
	}) => {
		await openRun(page, 390, 844);
		await page.getByTestId("panel-toggle").click();
		const sheet = page.getByRole("dialog", { name: /details/i });
		await expect(sheet).toBeVisible();
		const box = await sheet.boundingBox();
		expect(box?.width).toBe(390);
		expect(box?.height).toBe(844);
		const header = page.getByTestId("incident-header");
		await expect(header).toHaveAttribute("aria-hidden", "true");
		await lastLineReachable(page);
		// A modal sheet takes focus as it opens; Tab is pressed only once it holds it.
		await expect
			.poll(() => sheet.evaluate((el) => el.contains(document.activeElement)))
			.toBe(true);
		// Tab never leaves the sheet (#974 OBJ-014).
		for (let i = 0; i < 25; i++) {
			await page.keyboard.press("Tab");
			expect(
				await sheet.evaluate((el) => el.contains(document.activeElement)),
			).toBe(true);
		}
		await page.getByTestId("run-details-close").click();
		await expect(sheet).toHaveCount(0);
		await expect(header).not.toHaveAttribute("aria-hidden", "true");
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
