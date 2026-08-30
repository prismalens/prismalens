// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";

/**
 * Investigation-agent surfaces (#501, ADR-0031): the Settings card, the wizard's
 * keyless Claude-session path, and the raw-report banner.
 *
 * Every verdict here is served from a fixture rather than the machine running
 * the suite: a real `GET /settings/harnesses` answers from PATH and the session
 * file, so a CI box and a developer laptop would assert different things. The
 * fixtures below carry no credential material — a verdict names a route, never a
 * key.
 */

const SHOTS = "e2e/journeys/screenshots";

/** The exact remedy text the server's resolver returns for claude-code. */
const CLAUDE_REMEDY =
	"add an API key in Settings → AI provider, or sign in with the Claude CLI (claude /login)";
const DEEPAGENTS_REMEDY = "add an API key in Settings → AI provider";

type HarnessFixture = {
	id: string;
	label: string;
	implemented: boolean;
	verdict:
		| { usable: true; route: "api-key" }
		| { usable: true; route: "cli-session"; verified: boolean }
		| { usable: false; reason: string };
};

const CODEX: HarnessFixture = {
	id: "codex",
	label: "Codex",
	implemented: false,
	verdict: { usable: false, reason: "codex harness not implemented" },
};

/** A machine with a signed-in Claude CLI session and no keys at all. */
const SESSION_ONLY: HarnessFixture[] = [
	{
		id: "deepagents",
		label: "deepagents (ACP)",
		implemented: true,
		verdict: { usable: false, reason: DEEPAGENTS_REMEDY },
	},
	{
		id: "claude-code",
		label: "Claude Code (Agent SDK)",
		implemented: true,
		verdict: { usable: true, route: "cli-session", verified: true },
	},
	CODEX,
];

/** A machine with API keys and no CLI session. */
const KEYS_ONLY: HarnessFixture[] = [
	{
		id: "deepagents",
		label: "deepagents (ACP)",
		implemented: true,
		verdict: { usable: true, route: "api-key" },
	},
	{
		id: "claude-code",
		label: "Claude Code (Agent SDK)",
		implemented: true,
		verdict: { usable: true, route: "api-key" },
	},
	CODEX,
];

/** A fresh machine: nothing signed in, no keys. */
const NOTHING: HarnessFixture[] = [
	{
		id: "deepagents",
		label: "deepagents (ACP)",
		implemented: true,
		verdict: { usable: false, reason: DEEPAGENTS_REMEDY },
	},
	{
		id: "claude-code",
		label: "Claude Code (Agent SDK)",
		implemented: true,
		verdict: { usable: false, reason: CLAUDE_REMEDY },
	},
	CODEX,
];

const isHarnessesUrl = (url: URL) => url.pathname === "/api/settings/harnesses";

async function serveHarnesses(
	page: Page,
	harnesses: HarnessFixture[],
): Promise<void> {
	await page.route(isHarnessesUrl, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ harnesses }),
		});
	});
}

async function failHarnesses(page: Page): Promise<void> {
	await page.route(isHarnessesUrl, async (route) => {
		await route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({ message: "harness status unavailable" }),
		});
	});
}

/** Force the active Tier-1 provider so the mismatch warning is deterministic. */
async function serveActiveProvider(
	page: Page,
	provider: string,
): Promise<void> {
	await page.route(
		(url) => url.pathname === "/api/settings/llm/config",
		async (route) => {
			if (route.request().method() !== "GET") {
				await route.fallback();
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					activeProvider: provider,
					providers: { [provider]: { model: "seeded-model" } },
					harness: "auto",
				}),
			});
		},
	);
}

async function openAiSettings(page: Page): Promise<void> {
	await page.goto("/settings?tab=ai");
	await expect(
		page.getByRole("heading", { name: "Investigation agent" }),
	).toBeVisible({ timeout: 15_000 });
}

const card = (page: Page) => page.getByTestId("harness-settings");

test.describe("Investigation agent settings card (#501)", () => {
	test("lists Auto and every implemented harness, badged from the server verdict", async ({
		page,
	}) => {
		await serveHarnesses(page, SESSION_ONLY);
		await openAiSettings(page);

		await expect(page.getByRole("radio", { name: "Auto (recommended)" })).toBeVisible();
		await expect(page.getByRole("radio", { name: "Claude Code (Agent SDK)" })).toBeVisible();
		await expect(page.getByRole("radio", { name: "deepagents (ACP)" })).toBeVisible();
		// Reserved, unimplemented — it must not be offerable.
		await expect(page.getByRole("radio", { name: "Codex" })).toHaveCount(0);

		await expect(card(page).getByText("Signed-in Claude session", { exact: true })).toBeVisible();
		await expect(card(page).getByText("Not authenticated", { exact: true })).toBeVisible();
	});

	test("badges an API-key route as such", async ({ page }) => {
		await serveHarnesses(page, KEYS_ONLY);
		await openAiSettings(page);

		await expect(card(page).getByText("API key", { exact: true })).toHaveCount(2);
		await expect(card(page).getByText("Not authenticated", { exact: true })).toHaveCount(0);
	});

	test("renders the server's remedy text verbatim rather than its own", async ({
		page,
	}) => {
		await serveHarnesses(page, NOTHING);
		await openAiSettings(page);

		await expect(card(page).getByText(CLAUDE_REMEDY)).toBeVisible();
		await expect(card(page).getByText(DEEPAGENTS_REMEDY).first()).toBeVisible();
	});

	test("warns when the pinned harness has no usable credential", async ({
		page,
	}) => {
		await serveHarnesses(page, NOTHING);
		await openAiSettings(page);

		await expect(page.getByTestId("harness-warning")).toHaveCount(0);
		await page.getByRole("radio", { name: "Claude Code (Agent SDK)" }).click();

		const warning = page.getByTestId("harness-warning");
		await expect(warning).toBeVisible();
		await expect(warning).toContainText("is not authenticated");
		await expect(warning).toContainText(CLAUDE_REMEDY);
	});

	test("warns on a harness/provider mismatch instead of rerouting", async ({
		page,
	}) => {
		await serveActiveProvider(page, "anthropic");
		await serveHarnesses(page, KEYS_ONLY);
		await openAiSettings(page);

		await page.getByRole("radio", { name: "deepagents (ACP)" }).click();
		const warning = page.getByTestId("harness-warning");
		await expect(warning).toBeVisible();
		await expect(warning).toContainText("speaks the OpenAI protocol");
		await expect(warning).toContainText("Anthropic");
	});

	// A pinned claude-code authenticates through its own cli-session route, so the
	// Tier-1 provider does not gate it. Warning here would flag a working config.
	test("stays quiet when claude-code is pinned against a non-Anthropic provider", async ({
		page,
	}) => {
		await serveActiveProvider(page, "openai");
		await serveHarnesses(page, SESSION_ONLY);
		await openAiSettings(page);

		await page.getByRole("radio", { name: "Claude Code (Agent SDK)" }).click();
		await expect(page.getByTestId("harness-warning")).toHaveCount(0);
	});

	test("keeps the card usable when the status endpoint fails", async ({
		page,
	}) => {
		await failHarnesses(page);
		await openAiSettings(page);

		await expect(page.getByTestId("harness-status-error")).toBeVisible();
		await expect(page.getByRole("radio", { name: "Claude Code (Agent SDK)" })).toBeVisible();
	});
});

/**
 * The banner is keyed on the host-stamped `reportMode`, so the fixture patches
 * exactly that field on the seeded investigation and changes nothing else.
 */
const RAW_REPORT_INVESTIGATION = "d0111111-1111-4111-8111-111111111111";

async function serveRawReport(page: Page, id: string): Promise<void> {
	await page.route(
		(url) => url.pathname === `/api/investigations/${id}`,
		async (route) => {
			const response = await route.fetch();
			const body = (await response.json()) as {
				report?: { reportMode?: string };
			};
			if (body.report) body.report.reportMode = "raw";
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(body),
			});
		},
	);
}

async function openAnalysisTab(page: Page, id: string): Promise<void> {
	await page.goto(`/investigations/${id}`);
	await expect(page.getByRole("tab", { name: "Analysis" })).toBeVisible({
		timeout: 15_000,
	});
	await page.getByRole("tab", { name: "Analysis" }).click();
	await expect(page.getByText("Root Cause Analysis")).toBeVisible({
		timeout: 15_000,
	});
}

test.describe("Raw-report banner (#501)", () => {
	test("stays hidden for a synthesized report", async ({ page }) => {
		await openAnalysisTab(page, RAW_REPORT_INVESTIGATION);
		await expect(page.getByTestId("raw-report-banner")).toHaveCount(0);
	});

	test("explains an unsynthesized report and links to the provider settings", async ({
		page,
	}) => {
		await serveRawReport(page, RAW_REPORT_INVESTIGATION);
		await openAnalysisTab(page, RAW_REPORT_INVESTIGATION);

		const banner = page.getByTestId("raw-report-banner");
		await expect(banner).toBeVisible();
		await expect(banner).toContainText("Raw harness output");
		await expect(
			banner.getByRole("link", { name: "Add a provider key in Settings" }),
		).toBeVisible();
	});
});

/**
 * Wizard step 2. `/setup` redirects once setup is complete, and the dev-stack
 * seed completes it, so the status endpoint is served from a fixture to hold the
 * wizard on the AI-provider step.
 */
async function serveSetupOnAiProviderStep(page: Page): Promise<void> {
	await page.route(
		(url) => url.pathname === "/api/setup/status",
		async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					setupComplete: true,
					steps: {
						owner: true,
						aiProvider: false,
						codeLocation: false,
						firstIncident: false,
					},
					currentStep: "ai_provider",
				}),
			});
		},
	);
}

async function openWizardAiStep(page: Page): Promise<void> {
	await page.goto("/setup");
	await expect(
		page.getByRole("heading", { name: "Connect an AI provider" }),
	).toBeVisible({ timeout: 15_000 });
}

test.describe("Wizard keyless Claude-session path (#501)", () => {
	test("offers the subscription path when a CLI session is usable", async ({
		page,
	}) => {
		await serveSetupOnAiProviderStep(page);
		await serveHarnesses(page, SESSION_ONLY);
		await openWizardAiStep(page);

		const option = page.getByTestId("wizard-claude-session");
		await expect(option).toBeVisible();
		await expect(option).toContainText("no API key needed");
		await expect(
			option.getByRole("button", { name: "Use my Claude subscription" }),
		).toBeEnabled();
	});

	test("does not offer it when the only route is an API key", async ({
		page,
	}) => {
		await serveSetupOnAiProviderStep(page);
		await serveHarnesses(page, KEYS_ONLY);
		await openWizardAiStep(page);

		await expect(page.getByTestId("wizard-claude-session")).toHaveCount(0);
	});
});

/**
 * Design evidence for the frontend gate (AGENTS.md). Element-scoped rather than
 * full-page: the changed surface is the card, and a narrow frame keeps the
 * committed PNGs clear of the chrome around it.
 */
test.describe("Design evidence (#501)", () => {
	const setTheme = async (page: Page, theme: "light" | "dark") => {
		await page.evaluate((value) => {
			document.cookie = `prismalens-theme=${value}; path=/; max-age=31536000`;
		}, theme);
		await page.reload();
		await expect(page.locator("html")).toHaveClass(new RegExp(theme));
	};

	test("settings card: default, dark, empty and error states", async ({
		page,
	}) => {
		await serveHarnesses(page, SESSION_ONLY);
		await openAiSettings(page);

		await setTheme(page, "light");
		await expect(card(page)).toBeVisible({ timeout: 15_000 });
		await page.waitForLoadState("networkidle");
		await card(page).screenshot({ path: `${SHOTS}/settings-harness-default.png` });

		await setTheme(page, "dark");
		await expect(card(page)).toBeVisible({ timeout: 15_000 });
		await page.waitForLoadState("networkidle");
		await card(page).screenshot({ path: `${SHOTS}/settings-harness-dark.png` });

		// "Empty" for this card is a machine holding no credential at all — the
		// state a fresh install is in, and the one #501 was reported from.
		await setTheme(page, "light");
		await page.unroute(isHarnessesUrl);
		await serveHarnesses(page, NOTHING);
		await page.reload();
		await expect(card(page).getByText(CLAUDE_REMEDY)).toBeVisible({
			timeout: 15_000,
		});
		await page.waitForLoadState("networkidle");
		await card(page).screenshot({ path: `${SHOTS}/settings-harness-empty.png` });

		await page.unroute(isHarnessesUrl);
		await failHarnesses(page);
		await page.reload();
		await expect(page.getByTestId("harness-status-error")).toBeVisible({
			timeout: 15_000,
		});
		await page.waitForLoadState("networkidle");
		await card(page).screenshot({ path: `${SHOTS}/settings-harness-error.png` });
	});

	test("raw-report banner: default and dark", async ({ page }) => {
		await serveRawReport(page, RAW_REPORT_INVESTIGATION);
		await openAnalysisTab(page, RAW_REPORT_INVESTIGATION);

		const banner = page.getByTestId("raw-report-banner");

		await setTheme(page, "light");
		await page.getByRole("tab", { name: "Analysis" }).click();
		await expect(banner).toBeVisible({ timeout: 15_000 });
		await page.waitForLoadState("networkidle");
		await banner.screenshot({ path: `${SHOTS}/raw-report-banner-default.png` });

		await setTheme(page, "dark");
		await page.getByRole("tab", { name: "Analysis" }).click();
		await expect(banner).toBeVisible({ timeout: 15_000 });
		await page.waitForLoadState("networkidle");
		await banner.screenshot({ path: `${SHOTS}/raw-report-banner-dark.png` });
	});

	test("wizard subscription option: default and dark", async ({ page }) => {
		await serveSetupOnAiProviderStep(page);
		await serveHarnesses(page, SESSION_ONLY);
		await openWizardAiStep(page);

		const option = page.getByTestId("wizard-claude-session");

		await setTheme(page, "light");
		await expect(option).toBeVisible({ timeout: 15_000 });
		await page.waitForLoadState("networkidle");
		await option.screenshot({ path: `${SHOTS}/wizard-claude-session-default.png` });

		await setTheme(page, "dark");
		await expect(option).toBeVisible({ timeout: 15_000 });
		await page.waitForLoadState("networkidle");
		await option.screenshot({ path: `${SHOTS}/wizard-claude-session-dark.png` });
	});
});
