// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import { investigateButton } from "./verb";

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

/** A `GET /settings/harnesses` row in today's shape (ADR 0003 §9, #639). */
function harnessRow(id: string, label: string, installed: boolean) {
	return {
		id,
		label,
		binary: `${id}-acp`,
		installed,
		tested: null,
		install: `install ${id}`,
		defaultModel: null,
		modelVia: "config",
		loginHint: "",
		models: { source: "catalogue", asOf: "2026-09-23T00:00:00Z", entries: [] },
	};
}

const NOTHING_HARNESSES = [
	harnessRow("deepagents", "deepagents", false),
	harnessRow("claude-code", "Claude Code", false),
	harnessRow("codex", "Codex", false),
];

const RUNNABLE_HARNESSES = [
	harnessRow("deepagents", "deepagents", true),
	harnessRow("claude-code", "Claude Code", true),
	harnessRow("codex", "Codex", false),
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

/**
 * The band's New run opens the draft on Conversation (#673); the draft's
 * Investigate carries the gate, its reason under the box.
 */
async function bandInvestigate(page: Page) {
	await page.getByTestId("band-more").click({ timeout: 15_000 });
	await page.getByTestId("band-menu-new-run").click();
	return investigateButton(page);
}

async function expectReason(page: Page, reason: string) {
	await expect(page.getByTestId("composer-blocked")).toContainText(reason, {
		timeout: 15_000,
	});
}

/** A refused start says why under the box, in the server's words. */
async function expectRefusal(page: Page, reason: string) {
	await expect(page.getByTestId("composer-refusal")).toHaveText(reason, {
		timeout: 15_000,
	});
}

test.describe("#520 part B — incident record investigate gate", () => {
	test("band investigate is disabled with visible reason when no harness or provider is usable", async ({
		page,
	}) => {
		await serveUnusableLlmAndHarnesses(page);
		const id = await createIncident(page, `Gate disabled ${Date.now()}`);

		await page.goto(`/incidents/${id}/alerts`);
		await expect(page.getByTestId("incident-state-band")).toBeVisible({
			timeout: 15_000,
		});

		const investigateBtn = await bandInvestigate(page);
		await expect(investigateBtn).toBeVisible({ timeout: 15_000 });
		await expect(investigateBtn).toBeDisabled();
		await expectReason(page, UNUSABLE_SELECTION_REASON);
	});

	test("band investigate is enabled when a harness or provider is usable", async ({
		page,
	}) => {
		await serveRunnableLlmAndHarnesses(page);
		const id = await createIncident(page, `Gate enabled ${Date.now()}`);

		await page.goto(`/incidents/${id}/alerts`);
		await expect(page.getByTestId("incident-state-band")).toBeVisible({
			timeout: 15_000,
		});

		const investigateBtn = await bandInvestigate(page);
		await expect(investigateBtn).toBeVisible({ timeout: 15_000 });
		await expect(investigateBtn).toBeEnabled();
	});

	test("handles server refusal (412) by rendering the refusal reason under the box", async ({
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

		await page.goto(`/incidents/${id}/alerts`);
		await expect(page.getByTestId("incident-state-band")).toBeVisible({
			timeout: 15_000,
		});

		const investigateBtn = await bandInvestigate(page);
		await expect(investigateBtn).toBeEnabled();
		await investigateBtn.click();

		await expectRefusal(page, refusalReason);
	});

	test("design evidence: default, dark, and refusal error states", async ({
		page,
	}) => {
		// 1. Default (light): disabled button with reason tooltip visible
		await page.emulateMedia({ colorScheme: "light" });
		await serveUnusableLlmAndHarnesses(page);
		const defaultId = await createIncident(
			page,
			`Gate evidence default ${Date.now()}`,
		);
		await page.goto(`/incidents/${defaultId}/alerts`);
		await page.evaluate(() => {
			document.cookie = "prismalens-theme=light; path=/; max-age=31536000";
		});
		await page.reload();
		await expect(page.locator("html")).toHaveClass(/light/);
		await expect(page.getByTestId("incident-state-band")).toBeVisible({
			timeout: 15_000,
		});
		const defaultBtn = await bandInvestigate(page);
		await expect(defaultBtn).toBeDisabled({ timeout: 15_000 });
		await expectReason(page, UNUSABLE_SELECTION_REASON);

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
		const darkBtn = await bandInvestigate(page);
		await expect(darkBtn).toBeDisabled({ timeout: 15_000 });
		await expectReason(page, UNUSABLE_SELECTION_REASON);

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
		await page.goto(`/incidents/${errorId}/alerts`);
		await expect(page.locator("html")).toHaveClass(/light/);
		const errorBtn = await bandInvestigate(page);
		await expect(errorBtn).toBeEnabled({ timeout: 15_000 });
		await errorBtn.click();
		await expectRefusal(page, refusalReason);
	});
});
