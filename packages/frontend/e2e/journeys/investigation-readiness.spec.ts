// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";

/**
 * #521 — one readiness verdict for the investigation affordance.
 *
 * The incident-detail header and the detail progress tab used to each derive
 * their own boolean from `activeProvider` (and later from
 * `harnesses.some(runnable)`). Both are "someone picked something", not "a run
 * would start": the per-harness rows answer "if you PINNED this one", so a
 * runnable row sitting next to an unrunnable pin read as ready.
 *
 * The falsifier this locks down: a provider IS selected, the gate refuses, and
 * both surfaces say unavailable AND say why. The reason is the server's
 * words — these specs assert the exact string travels, because a disabled button
 * with no explanation is the half-fix.
 *
 * The dashboard's own panel used to be a third surface here; it is gone (the
 * Command Center screen was deleted), so this file no longer opens it.
 */

const SHOTS = "e2e/journeys/screenshots";

/**
 * A real gate message: anthropic is active with a model and a key, but the
 * harness is pinned to deepagents, which speaks only the OpenAI protocol. The
 * claude-code ROW is runnable, which is exactly what the old predicate saw.
 */
const PROTOCOL_MISMATCH_REASON =
	'Harness "deepagents" only supports OpenAI-protocol providers ' +
	'(openai/ollama/custom); active provider is "anthropic". ' +
	"Switch provider or set PRISMALENS_HARNESS to a harness that " +
	"supports it (e.g. claude-code for anthropic).";

/** A row that IS runnable, so `harnesses.some((h) => h.runnable)` stays true. */
const RUNNABLE_ROW = {
	id: "claude-code",
	label: "Claude Code (Agent SDK)",
	implemented: true,
	runnable: true,
	blockedReason: null,
	verdict: { usable: true, route: "api-key" },
};

const MISMATCHED_ROW = {
	id: "deepagents",
	label: "deepagents (ACP)",
	implemented: true,
	runnable: false,
	blockedReason: PROTOCOL_MISMATCH_REASON,
	verdict: {
		usable: false,
		cause: "not-authenticated",
		reason: PROTOCOL_MISMATCH_REASON,
	},
};

async function serveUnrunnableSelection(page: Page): Promise<void> {
	await page.route("**/api/settings/harnesses", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				harnesses: [RUNNABLE_ROW, MISMATCHED_ROW],
				selection: {
					runnable: false,
					harness: "deepagents",
					pinned: false,
					blockedReason: PROTOCOL_MISMATCH_REASON,
				},
			}),
		});
	});
}

async function serveRunnableSelection(page: Page): Promise<void> {
	await page.route("**/api/settings/harnesses", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				harnesses: [RUNNABLE_ROW, MISMATCHED_ROW],
				selection: {
					runnable: true,
					harness: "claude-code",
					pinned: false,
					blockedReason: null,
				},
			}),
		});
	});
}

async function failHarnesses(page: Page): Promise<void> {
	await page.route("**/api/settings/harnesses", async (route) => {
		await route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({ message: "harness probe failed" }),
		});
	});
}

async function createIncident(page: Page, title: string): Promise<string> {
	const created = await page.request.post("/api/incidents", { data: { title } });
	expect(created.ok()).toBeTruthy();
	const incident: { id: string } = await created.json();
	return incident.id;
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
	await page.emulateMedia({ colorScheme: theme });
	await page.evaluate((value) => {
		document.cookie = `prismalens-theme=${value}; path=/; max-age=31536000`;
	}, theme);
	await page.reload();
	await expect(page.locator("html")).toHaveClass(new RegExp(theme));
}

/**
 * The Investigation tab's own "start" button, scoped inside
 * `investigation-empty` — it shares an accessible name ("Investigate") with
 * the incident-detail header's button, which stays mounted once the tab is
 * switched, so an unscoped `getByRole` is a strict-mode violation.
 */
function tabInvestigateButton(page: Page) {
	return page
		.getByTestId("investigation-empty")
		.getByRole("button", { name: "Investigate", exact: true });
}

test.describe("#521 — the investigation affordance follows the server's gate", () => {
	test("incident-detail header and progress tab say unavailable with the same reason", async ({
		page,
	}) => {
		await serveUnrunnableSelection(page);
		const id = await createIncident(page, `Readiness probe ${Date.now()}`);

		await page.goto(`/incidents/${id}`);
		await expect(page.getByRole("heading", { name: /Readiness probe/ })).toBeVisible({
			timeout: 15_000,
		});

		// Header: disabled, and hovering names the reason.
		const headerBtn = page.getByRole("button", {
			name: "Investigate",
			exact: true,
		});
		await expect(headerBtn).toBeDisabled();
		await headerBtn.hover({ force: true });
		await expect(page.getByText(PROTOCOL_MISMATCH_REASON).first()).toBeVisible({
			timeout: 15_000,
		});

		// Progress tab: disabled, with the reason rendered inline.
		await page.getByRole("tab", { name: "Investigation" }).click();
		await expect(tabInvestigateButton(page)).toBeDisabled();
		await expect(page.getByText(PROTOCOL_MISMATCH_REASON).first()).toBeVisible();
	});

	test("a runnable selection enables both affordances", async ({ page }) => {
		await serveRunnableSelection(page);
		const title = `Runnable probe ${Date.now()}`;
		const id = await createIncident(page, title);

		await page.goto(`/incidents/${id}`);
		await expect(
			page.getByRole("button", { name: "Investigate", exact: true }),
		).toBeEnabled({ timeout: 15_000 });
		await page.getByRole("tab", { name: "Investigation" }).click();
		await expect(tabInvestigateButton(page)).toBeEnabled();
	});

	test("a failed harness probe blocks the affordance rather than opening it", async ({
		page,
	}) => {
		await failHarnesses(page);
		const id = await createIncident(page, `Probe failure ${Date.now()}`);

		await page.goto(`/incidents/${id}`);
		await page.getByRole("tab", { name: "Investigation" }).click();
		await expect(tabInvestigateButton(page)).toBeDisabled({
			timeout: 15_000,
		});
		await expect(
			page.getByText("Could not check agent status").first(),
		).toBeVisible();
	});

	test("design evidence: default, dark, empty, and error", async ({ page }) => {
		const shot = (name: string) =>
			page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

		// Default (light) — the incident-detail header, provider selected, gate
		// refusing. The dashboard panel this used to photograph is gone (the
		// Command Center screen was deleted); the header carries the same verdict.
		await serveUnrunnableSelection(page);
		const title = `Readiness evidence ${Date.now()}`;
		const id = await createIncident(page, title);
		await page.goto(`/incidents/${id}`);
		await expect(
			page.getByRole("heading", { name: new RegExp(title) }),
		).toBeVisible({ timeout: 15_000 });
		await setTheme(page, "light");
		await expect(
			page.getByRole("button", { name: "Investigate", exact: true }),
		).toBeDisabled({ timeout: 15_000 });
		await page.waitForLoadState("networkidle");
		await shot("investigation-readiness-default");

		// Dark — the same surface, same verdict.
		await setTheme(page, "dark");
		await expect(
			page.getByRole("button", { name: "Investigate", exact: true }),
		).toBeDisabled({ timeout: 15_000 });
		await page.waitForLoadState("networkidle");
		await shot("investigation-readiness-dark");

		// Empty — the detail progress tab with no investigations on the incident,
		// which is where the blocked affordance is the only thing on the card.
		await setTheme(page, "light");
		await page.getByRole("tab", { name: "Investigation" }).click();
		await expect(page.getByText("No investigation yet")).toBeVisible({
			timeout: 15_000,
		});
		await expect(tabInvestigateButton(page)).toBeDisabled();
		await page.waitForLoadState("networkidle");
		await shot("investigation-readiness-empty");

		// Error — the harness probe itself fails, so the gate stays shut and says so.
		await failHarnesses(page);
		await page.goto(`/incidents/${id}`);
		await page.getByRole("tab", { name: "Investigation" }).click();
		await expect(
			page.getByText("Could not check agent status").first(),
		).toBeVisible({ timeout: 15_000 });
		await page.waitForLoadState("networkidle");
		await shot("investigation-readiness-error");
	});
});
