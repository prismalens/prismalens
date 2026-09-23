// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";

/**
 * #520 part B — Incidents list investigate button gating & refusal handling.
 *
 * Covers the incident record's state-band Investigate action, reached by
 * opening a row (#523 moved the affordance off the list itself and onto the
 * band):
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

/**
 * What `pickAuto` returns when nothing resolves: claude-code's remedy, because it
 * is the most actionable. The button's tooltip renders the gate's words verbatim
 * now, not a generic frontend string (#521).
 */
const UNUSABLE_SELECTION_REASON =
	"the Claude Code CLI (claude) was not found on PATH — install the claude-code harness, or add an Anthropic API key in Settings → AI provider";

async function serveUnusableLlmAndHarnesses(page: Page) {
	await page.route("**/api/settings/harnesses", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				harnesses: NOTHING_HARNESSES,
				selection: {
					runnable: false,
					harness: null,
					pinned: false,
					pinnedBy: null,
					blockedReason: UNUSABLE_SELECTION_REASON,
				},
			}),
		});
	});
}

async function serveRunnableLlmAndHarnesses(page: Page) {
	await page.route("**/api/settings/harnesses", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				harnesses: RUNNABLE_HARNESSES,
				selection: {
					runnable: true,
					harness: "deepagents",
					pinned: false,
					pinnedBy: null,
					blockedReason: null,
				},
			}),
		});
	});
}

async function createIncident(page: Page, title: string): Promise<string> {
	const created = await page.request.post("/api/incidents", {
		data: { title },
	});
	expect(created.ok()).toBeTruthy();
	const incident: { id: string } = await created.json();
	return incident.id;
}

/** The band's primary action, and its tooltip trigger wrapper. */
function bandInvestigate(page: Page) {
	return page.getByTestId("band-investigate");
}
function bandInvestigateTrigger(page: Page) {
	return page.getByTestId("band-investigate-trigger");
}

test.describe("#520 part B — incident record investigate gate", () => {
	test("band investigate is disabled with visible reason when no harness or provider is usable", async ({
		page,
	}) => {
		await serveUnusableLlmAndHarnesses(page);
		const id = await createIncident(page, `Gate disabled ${Date.now()}`);

		await page.goto(`/incidents/${id}`);
		await expect(page.getByTestId("incident-state-band")).toBeVisible({
			timeout: 15_000,
		});

		const investigateBtn = bandInvestigate(page);
		await expect(investigateBtn).toBeVisible({ timeout: 15_000 });
		await expect(investigateBtn).toBeDisabled();

		// Reason is visible on screen on hover / focus
		const trigger = bandInvestigateTrigger(page);
		await trigger.hover();
		await expect(
			page.getByText(UNUSABLE_SELECTION_REASON).first(),
		).toBeVisible({ timeout: 15_000 });
	});

	test("band investigate is enabled when a harness or provider is usable", async ({
		page,
	}) => {
		await serveRunnableLlmAndHarnesses(page);
		const id = await createIncident(page, `Gate enabled ${Date.now()}`);

		await page.goto(`/incidents/${id}`);
		await expect(page.getByTestId("incident-state-band")).toBeVisible({
			timeout: 15_000,
		});

		const investigateBtn = bandInvestigate(page);
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
		const id = await createIncident(page, `Gate refusal ${Date.now()}`);

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
							failure: "no-harness",
							reason: refusalReason,
						},
					}),
				});
				return;
			}
			await route.fallback();
		});

		await page.goto(`/incidents/${id}`);
		await expect(page.getByTestId("incident-state-band")).toBeVisible({
			timeout: 15_000,
		});

		const investigateBtn = bandInvestigate(page);
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
		const defaultId = await createIncident(
			page,
			`Gate evidence default ${Date.now()}`,
		);
		await page.goto(`/incidents/${defaultId}`);
		await page.evaluate(() => {
			document.cookie = "prismalens-theme=light; path=/; max-age=31536000";
		});
		await page.reload();
		await expect(page.locator("html")).toHaveClass(/light/);
		await expect(page.getByTestId("incident-state-band")).toBeVisible({
			timeout: 15_000,
		});
		const defaultBtn = bandInvestigate(page);
		await expect(defaultBtn).toBeVisible({ timeout: 15_000 });
		const defaultTrigger = bandInvestigateTrigger(page);
		await defaultTrigger.hover();
		await expect(
			page.getByText(UNUSABLE_SELECTION_REASON).first(),
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
		await expect(page.getByTestId("incident-state-band")).toBeVisible({
			timeout: 15_000,
		});
		const darkBtn = bandInvestigate(page);
		await expect(darkBtn).toBeVisible({ timeout: 15_000 });
		const darkTrigger = bandInvestigateTrigger(page);
		await darkTrigger.hover();
		await expect(
			page.getByText(UNUSABLE_SELECTION_REASON).first(),
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
		const errorId = await createIncident(
			page,
			`Gate evidence error ${Date.now()}`,
		);
		await page.route("**/api/incidents/*/investigate", async (route) => {
			if (route.request().method() === "POST") {
				await route.fulfill({
					status: 412,
					contentType: "application/json",
					body: JSON.stringify({
						code: "PRECONDITION_FAILED",
						message: refusalReason,
						data: {
							failure: "no-harness",
							reason: refusalReason,
						},
					}),
				});
				return;
			}
			await route.fallback();
		});
		await page.goto(`/incidents/${errorId}`);
		await expect(page.locator("html")).toHaveClass(/light/);
		const errorBtn = bandInvestigate(page);
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
