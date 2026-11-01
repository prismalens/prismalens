// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";
import { test } from "../steps/fixtures";
import {
	fireIncident,
	LIVE,
	openWork,
	visit,
	waitForRun,
} from "../steps/product";
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
		await expect(page.getByTestId("add-agent-dialog")).toHaveCount(0);
		await expect(draft).toBeFocused();
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

	test("a run's step command has Run in terminal in the expanded step", async ({
		page,
		agents,
		alertmanager,
		deliverWebhook,
		unique,
	}) => {
		test.setTimeout(90_000);
		agents.install(["claude-agent-acp"], "claude");
		await page.request.post("/api/settings/harness/check", {
			data: { id: "claude-code" },
		});
		await page.request.patch("/api/settings/harness", {
			data: { harness: "claude-code" },
		});
		const inc = await fireIncident(page, alertmanager, deliverWebhook, {
			name: unique("TerminalStepCommand"),
			service: LIVE,
			session: "success",
		});
		await waitForRun(page, inc.id, (r) => r.status === "completed", "ready");

		await page.setViewportSize({ width: 1440, height: 900 });
		await hideQueryDevtools(page);
		await asHost(page);
		await visit(page, `/incidents/${inc.id}/conversation`);
		await openWork(page);
		const step = page.getByTestId("step").first();
		await expect(step.getByTestId("run-in-terminal")).toHaveCount(0);
		await step.getByTestId("step-toggle").click();
		const chip = step.getByTestId("step-command");
		await expect(chip.getByRole("button", { name: /copy/i })).toBeVisible();
		await chip.getByTestId("run-in-terminal").click();

		const draft = page
			.getByTestId("panel-bottom")
			.getByTestId("terminal-draft")
			.locator("input");
		await expect(draft).toHaveValue("git log --oneline -5");
		await expect(draft).toBeFocused();
	});
});
