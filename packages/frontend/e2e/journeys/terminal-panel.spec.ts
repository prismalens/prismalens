// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import { hideQueryDevtools } from "./live-stream-fixtures";

/**
 * The terminal in the layout's bottom panel (#931). The suite's browser reaches
 * the API through Vite, which the host check refuses, so availability is served
 * as the host's answer; these assert up to the staged line, not a live shell.
 * The inbox is the page: specs that reset the workspace share a worker's stack,
 * and the demo incident a run page needs is gone by then.
 */

async function asHost(page: Page) {
	await page.route(
		(url) => url.pathname === "/api/terminal/availability",
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ available: true }),
			}),
	);
}

async function openInbox(page: Page, width: number) {
	await page.setViewportSize({ width, height: 900 });
	await hideQueryDevtools(page);
	await asHost(page);
	await page.goto("/incidents");
	await inboxLoaded(page);
}

// The sidebar draws before the layout's key listener is attached; the page's heading is after it.
async function inboxLoaded(page: Page) {
	await expect(
		page.getByRole("heading", { name: "Incidents", level: 1 }),
	).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId("nav-terminal")).toBeVisible();
}

async function openRegistryChip(page: Page) {
	await page.goto("/settings?tab=agent");
	await expect(page.getByTestId("harness-settings")).toBeVisible({
		timeout: 15_000,
	});
	await page.getByTestId("harness-add-agent").first().click();
	await page.getByTestId("acp-registry-search").fill("auggie");
	await page.getByTestId("acp-registry-entry").first().click();
	return page.getByTestId("acp-registry-install").first();
}

test.describe("Terminal panel (#931)", () => {
	test("Ctrl+` and the sidebar's Terminal door show and hide it, and it stays open across a reload", async ({
		page,
	}) => {
		await openInbox(page, 1440);
		const panel = page.getByTestId("panel-bottom");
		await expect(panel).toHaveCount(0);

		await page.keyboard.press("Control+Backquote");
		await expect(panel.getByTestId("terminal-panel")).toBeVisible();
		await page.keyboard.press("Control+Backquote");
		await expect(panel).toHaveCount(0);

		const door = page.getByTestId("nav-terminal");
		await door.click();
		await expect(panel.getByTestId("terminal-panel")).toBeVisible();
		await expect(door).toHaveAttribute("aria-expanded", "true");

		await page.reload();
		await inboxLoaded(page);
		await expect(panel.getByTestId("terminal-panel")).toBeVisible();
		await page.getByRole("button", { name: "Hide the terminal" }).click();
		await expect(panel).toHaveCount(0);
	});

	test("a command's Run in terminal shows with the panel closed, opens it and stages the command", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await hideQueryDevtools(page);
		await asHost(page);
		const chip = await openRegistryChip(page);
		await expect(page.getByTestId("panel-bottom")).toHaveCount(0);
		await chip.getByTestId("run-in-terminal").click();

		const draft = page
			.getByTestId("panel-bottom")
			.getByTestId("terminal-draft")
			.locator("input");
		await expect(draft).toHaveValue("npx -y @augmentcode/auggie@0.36.0 --acp");
	});

	test("390 px: a command has Copy and no Run in terminal", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await hideQueryDevtools(page);
		await asHost(page);
		const chip = await openRegistryChip(page);
		await expect(chip).toBeVisible();
		await expect(chip.getByRole("button", { name: /copy/i })).toBeVisible();
		await expect(chip.getByTestId("run-in-terminal")).toHaveCount(0);
		await expect(page.getByTestId("panel-bottom")).toHaveCount(0);
	});
});
