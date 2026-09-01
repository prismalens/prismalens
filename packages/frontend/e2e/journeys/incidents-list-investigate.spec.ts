// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";

/**
 * #520 part B — Incidents list investigate button gating & refusal handling.
 *
 * Covers the incidents-list Investigate button:
 * - Disabled with reason tooltip when no provider or harness is usable.
 * - Enabled when a usable provider or harness is available.
 * - Handles HTTP 412 server refusal by displaying the refusal reason in a toast.
 * - Captures design evidence in default (light), dark, and error states.
 */

const NOTHING_HARNESSES = [
	{
		id: "deepagents",
		label: "deepagents (ACP)",
		implemented: true,
		runnable: false,
		blockedReason:
			"deepagents-acp was not found on PATH — install the deepagents harness, and add an API key in Settings → AI provider",
		verdict: {
			usable: false,
			cause: "not-installed",
			reason:
				"deepagents-acp was not found on PATH — install the deepagents harness, and add an API key in Settings → AI provider",
		},
	},
	{
		id: "claude-code",
		label: "Claude Code (Agent SDK)",
		implemented: true,
		runnable: false,
		blockedReason:
			"the Claude Code CLI (claude) was not found on PATH — install the claude-code harness, or add an Anthropic API key in Settings → AI provider",
		verdict: {
			usable: false,
			cause: "not-installed",
			reason:
				"the Claude Code CLI (claude) was not found on PATH — install the claude-code harness, or add an Anthropic API key in Settings → AI provider",
		},
	},
	{
		id: "codex",
		label: "Codex",
		implemented: false,
		runnable: false,
		blockedReason: "codex harness not implemented",
		verdict: {
			usable: false,
			cause: "not-implemented",
			reason: "codex harness not implemented",
		},
	},
];

const RUNNABLE_HARNESSES = [
	{
		id: "deepagents",
		label: "deepagents (ACP)",
		implemented: true,
		runnable: true,
		blockedReason: null,
		verdict: { usable: true, route: "api-key" },
	},
	{
		id: "claude-code",
		label: "Claude Code (Agent SDK)",
		implemented: true,
		runnable: true,
		blockedReason: null,
		verdict: { usable: true, route: "api-key" },
	},
	{
		id: "codex",
		label: "Codex",
		implemented: false,
		runnable: false,
		blockedReason: "codex harness not implemented",
		verdict: {
			usable: false,
			cause: "not-implemented",
			reason: "codex harness not implemented",
		},
	},
];

async function serveUnusableLlmAndHarnesses(page: Page) {
	await page.route("**/api/settings/llm/config", async (route) => {
		if (route.request().method() === "GET") {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					activeProvider: null,
					providers: {},
					harness: "auto",
				}),
			});
			return;
		}
		await route.fallback();
	});
	await page.route("**/api/settings/harnesses", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ harnesses: NOTHING_HARNESSES }),
		});
	});
}

async function serveRunnableLlmAndHarnesses(page: Page) {
	await page.route("**/api/settings/llm/config", async (route) => {
		if (route.request().method() === "GET") {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					activeProvider: "custom",
					providers: { custom: { model: "smoke-test-stub" } },
					harness: "auto",
				}),
			});
			return;
		}
		await route.fallback();
	});
	await page.route("**/api/settings/harnesses", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ harnesses: RUNNABLE_HARNESSES }),
		});
	});
}

test.describe("#520 part B — incidents list investigate gate", () => {
	test("incidents-list investigate button is disabled with visible reason when no harness or provider is usable", async ({
		page,
	}) => {
		await serveUnusableLlmAndHarnesses(page);

		await page.goto("/incidents");
		await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible({
			timeout: 15_000,
		});

		const investigateBtn = page
			.getByTestId("incident-investigate-button")
			.first();
		await expect(investigateBtn).toBeVisible({ timeout: 15_000 });
		await expect(investigateBtn).toBeDisabled();

		// Reason is visible on screen on hover / focus
		const trigger = page
			.getByTestId("incident-investigate-trigger")
			.first();
		await trigger.hover();
		await expect(
			page
				.getByText(
					"Configure an AI provider in Settings to enable investigations",
				)
				.first(),
		).toBeVisible({ timeout: 15_000 });
	});

	test("incidents-list investigate button is enabled when a harness or provider is usable", async ({
		page,
	}) => {
		await serveRunnableLlmAndHarnesses(page);

		await page.goto("/incidents");
		await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible({
			timeout: 15_000,
		});

		const investigateBtn = page
			.getByTestId("incident-investigate-button")
			.first();
		await expect(investigateBtn).toBeVisible({ timeout: 15_000 });
		await expect(investigateBtn).toBeEnabled();
	});

	test("handles server refusal (412) by rendering the refusal reason in a toast", async ({
		page,
	}) => {
		const refusalReason =
			"LLM not configured: no active provider/model. Configure via Settings or set PRISMALENS_LLM_PROVIDER + PRISMALENS_LLM_MODEL.";

		// Set client view as runnable so the button can be clicked
		await serveRunnableLlmAndHarnesses(page);

		// Server returns 412 refusal (Part A wire protocol)
		await page.route("**/api/incidents/*/investigate", async (route) => {
			if (route.request().method() === "POST") {
				await route.fulfill({
					status: 412,
					contentType: "application/json",
					body: JSON.stringify({
						code: "PRECONDITION_FAILED",
						message: refusalReason,
						data: {
							failure: "llm-not-configured",
							reason: refusalReason,
						},
					}),
				});
				return;
			}
			await route.fallback();
		});

		await page.goto("/incidents");
		await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible({
			timeout: 15_000,
		});

		const investigateBtn = page
			.getByTestId("incident-investigate-button")
			.first();
		await expect(investigateBtn).toBeEnabled();
		await investigateBtn.click();

		// Toast appears with refusal reason rather than a generic error
		await expect(
			page.getByText("Investigation refused", { exact: true }),
		).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByText(refusalReason, { exact: true })).toBeVisible({
			timeout: 15_000,
		});
	});

	test("design evidence: default, dark, and refusal error states", async ({
		page,
	}) => {
		const shot = (name: string) =>
			page.screenshot({
				path: `e2e/journeys/screenshots/${name}.png`,
				fullPage: true,
			});

		// 1. Default (light): disabled button with reason tooltip visible
		await page.emulateMedia({ colorScheme: "light" });
		await serveUnusableLlmAndHarnesses(page);
		await page.goto("/incidents");
		await page.evaluate(() => {
			document.cookie = "prismalens-theme=light; path=/; max-age=31536000";
		});
		await page.reload();
		await expect(page.locator("html")).toHaveClass(/light/);
		await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible({
			timeout: 15_000,
		});
		const defaultBtn = page
			.getByTestId("incident-investigate-button")
			.first();
		await expect(defaultBtn).toBeVisible({ timeout: 15_000 });
		const defaultTrigger = page
			.getByTestId("incident-investigate-trigger")
			.first();
		await defaultTrigger.hover();
		await expect(
			page
				.getByText(
					"Configure an AI provider in Settings to enable investigations",
				)
				.first(),
		).toBeVisible({ timeout: 15_000 });
		await page.waitForLoadState("networkidle");
		await shot("incidents-list-investigate-default");

		// 2. Dark: disabled button with reason tooltip in dark theme
		await page.emulateMedia({ colorScheme: "dark" });
		await page.evaluate(() => {
			document.cookie = "prismalens-theme=dark; path=/; max-age=31536000";
		});
		await page.reload();
		await expect(page.locator("html")).toHaveClass(/dark/);
		await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible({
			timeout: 15_000,
		});
		const darkBtn = page.getByTestId("incident-investigate-button").first();
		await expect(darkBtn).toBeVisible({ timeout: 15_000 });
		const darkTrigger = page
			.getByTestId("incident-investigate-trigger")
			.first();
		await darkTrigger.hover();
		await expect(
			page
				.getByText(
					"Configure an AI provider in Settings to enable investigations",
				)
				.first(),
		).toBeVisible({ timeout: 15_000 });
		await page.waitForLoadState("networkidle");
		await shot("incidents-list-investigate-dark");

		// 3. Error state: server refusal toast
		const refusalReason =
			"LLM not configured: no active provider/model. Configure via Settings or set PRISMALENS_LLM_PROVIDER + PRISMALENS_LLM_MODEL.";
		await page.emulateMedia({ colorScheme: "light" });
		await page.evaluate(() => {
			document.cookie = "prismalens-theme=light; path=/; max-age=31536000";
		});
		await page.reload();
		await serveRunnableLlmAndHarnesses(page);
		await page.route("**/api/incidents/*/investigate", async (route) => {
			if (route.request().method() === "POST") {
				await route.fulfill({
					status: 412,
					contentType: "application/json",
					body: JSON.stringify({
						code: "PRECONDITION_FAILED",
						message: refusalReason,
						data: {
							failure: "llm-not-configured",
							reason: refusalReason,
						},
					}),
				});
				return;
			}
			await route.fallback();
		});
		await page.goto("/incidents");
		await expect(page.locator("html")).toHaveClass(/light/);
		const errorBtn = page.getByTestId("incident-investigate-button").first();
		await expect(errorBtn).toBeEnabled({ timeout: 15_000 });
		await errorBtn.click();
		await expect(
			page.getByText("Investigation refused", { exact: true }),
		).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByText(refusalReason, { exact: true })).toBeVisible({
			timeout: 15_000,
		});
		await page.waitForLoadState("networkidle");
		await shot("incidents-list-investigate-error");
	});
});
