// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import {
	hideQueryDevtools,
	INVESTIGATION_ID,
	serveInvestigationAs,
} from "./live-stream-fixtures";

/**
 * The terminal in the layout's bottom panel (#931). The suite's browser reaches
 * the API through Vite, which the host check refuses, so availability is served
 * as the host's answer; these assert up to the staged line, not a live shell.
 */
const INCIDENT_ID = "b0111111-1111-4111-8111-111111111111";
const RUN_URL = `/incidents/${INCIDENT_ID}/conversation?investigation=${INVESTIGATION_ID}`;

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

async function openRun(page: Page, width: number) {
	await page.setViewportSize({ width, height: 900 });
	await hideQueryDevtools(page);
	await asHost(page);
	await serveInvestigationAs(page, INVESTIGATION_ID, { status: "completed" });
	await page.goto(RUN_URL);
	await expect(page.getByTestId("run-page")).toBeVisible({ timeout: 15_000 });
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
		await openRun(page, 1440);
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
		await expect(page.getByTestId("run-page")).toBeVisible({ timeout: 15_000 });
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
