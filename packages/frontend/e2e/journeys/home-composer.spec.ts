// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";
import { test } from "../steps/fixtures";
import { visit } from "../steps/product";

/**
 * Home shows while the workspace has no incidents. The stack is shared with
 * seeded specs, so the empty counts are served here instead of resetting data.
 */
async function looksNew(page: Page, services: "keep" | "none") {
	await page.route("**/api/incidents/stats*", async (route) => {
		const res = await route.fetch();
		await route.fulfill({
			response: res,
			json: { ...(await res.json()), total: 0 },
		});
	});
	if (services === "none")
		await page.route("**/api/services?*", async (route) => {
			const res = await route.fetch();
			await route.fulfill({
				response: res,
				json: { ...(await res.json()), data: [], total: 0 },
			});
		});
}

test.describe("Home on a new workspace", () => {
	test("Send starts a thread from the first line and opens it", async ({
		page,
		agents,
	}) => {
		await looksNew(page, "keep");
		agents.install(["claude-agent-acp"], "claude");
		await page.request.post("/api/settings/harness/check", {
			data: { id: "claude-code" },
		});
		await page.request.patch("/api/settings/harness", {
			data: { harness: "claude-code" },
		});
		await visit(page, "/incidents");
		const home = page.getByTestId("home");
		await expect(home).toBeVisible();
		await home
			.getByTestId("composer-input")
			.fill("Checkout returns 502 since noon\nMostly EU traffic");
		await home.getByTestId("composer-send").click();
		await expect(page).toHaveURL(
			/\/incidents\/[^/]+\/conversation\?investigation=/,
		);
		await expect(page.getByTestId("transcript")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("crumb-incident")).toContainText(
			"Checkout returns 502 since noon",
		);
		// A chat is not an incident: no severity, firing or Resolve button (#1020 D10).
		await expect(page.getByTestId("header-severity")).toHaveCount(0);
		await expect(page.getByTestId("header-firing")).toHaveCount(0);
		await expect(page.getByTestId("header-resolve")).toHaveCount(0);
		await expect(page).not.toHaveTitle(/INC-/);
	});

	test("or add a service opens Add a service on its code field", async ({
		page,
	}) => {
		await looksNew(page, "none");
		await visit(page, "/incidents");
		await page.getByTestId("home-add-folder").click();
		const dialog = page.getByTestId("service-form-dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByTestId("service-repository-input")).toBeFocused();
	});

	test("New in the sidebar opens the same box on a busy workspace", async ({
		page,
	}) => {
		await visit(page, "/incidents");
		await page.getByTestId("nav-new").click();
		await expect(page).toHaveURL(/\/new$/);
		await expect(
			page.getByTestId("home").getByTestId("composer-input"),
		).toBeVisible();
	});
});
