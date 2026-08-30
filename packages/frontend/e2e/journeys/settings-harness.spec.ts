// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { LLM_PROVIDERS } from "@prismalens/config/llm";
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

/**
 * The exact remedy strings the server's resolver returns. #518: a missing binary
 * and a missing key are different problems, so they carry different `cause`
 * values and different words — and neither mentions `claude /login`, which is
 * unrunnable on a machine that has no Claude CLI.
 */
const CLAUDE_NOT_INSTALLED =
	"the Claude Code CLI (claude) was not found on PATH — install the claude-code harness, or add an Anthropic API key in Settings → AI provider";
const DEEPAGENTS_NOT_INSTALLED =
	"deepagents-acp was not found on PATH — install the deepagents harness, and add an API key in Settings → AI provider";
const DEEPAGENTS_NOT_AUTHENTICATED = "add an API key in Settings → AI provider";

type HarnessFixture = {
	id: string;
	label: string;
	implemented: boolean;
	/** Would a job pinned to this harness start? Answered by the shared gate. */
	runnable: boolean;
	blockedReason: string | null;
	verdict:
		| { usable: true; route: "api-key" }
		| { usable: true; route: "cli-session"; verified: boolean }
		| {
				usable: false;
				cause: "not-implemented" | "not-installed" | "not-authenticated";
				reason: string;
		  };
};

const CODEX: HarnessFixture = {
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
};

/** A machine with a signed-in Claude CLI session, no keys, no deepagents. */
const SESSION_ONLY: HarnessFixture[] = [
	{
		id: "deepagents",
		label: "deepagents (ACP)",
		implemented: true,
		runnable: false,
		blockedReason: DEEPAGENTS_NOT_INSTALLED,
		verdict: {
			usable: false,
			cause: "not-installed",
			reason: DEEPAGENTS_NOT_INSTALLED,
		},
	},
	{
		id: "claude-code",
		label: "Claude Code (Agent SDK)",
		implemented: true,
		runnable: true,
		blockedReason: null,
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
	CODEX,
];

/** The #518 falsifier machine: no agent binary anywhere, no keys. */
const NOTHING: HarnessFixture[] = [
	{
		id: "deepagents",
		label: "deepagents (ACP)",
		implemented: true,
		runnable: false,
		blockedReason: DEEPAGENTS_NOT_INSTALLED,
		verdict: {
			usable: false,
			cause: "not-installed",
			reason: DEEPAGENTS_NOT_INSTALLED,
		},
	},
	{
		id: "claude-code",
		label: "Claude Code (Agent SDK)",
		implemented: true,
		runnable: false,
		blockedReason: CLAUDE_NOT_INSTALLED,
		verdict: {
			usable: false,
			cause: "not-installed",
			reason: CLAUDE_NOT_INSTALLED,
		},
	},
	CODEX,
];

/** Agents present on the machine, but no credential for either. */
const INSTALLED_BUT_UNAUTHENTICATED: HarnessFixture[] = [
	{
		id: "deepagents",
		label: "deepagents (ACP)",
		implemented: true,
		runnable: false,
		blockedReason: DEEPAGENTS_NOT_AUTHENTICATED,
		verdict: {
			usable: false,
			cause: "not-authenticated",
			reason: DEEPAGENTS_NOT_AUTHENTICATED,
		},
	},
	{
		id: "claude-code",
		label: "Claude Code (Agent SDK)",
		implemented: true,
		runnable: true,
		blockedReason: null,
		verdict: { usable: true, route: "cli-session", verified: false },
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
	harness = "auto",
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
					harness,
				}),
			});
		},
	);
}

/**
 * The two reads the AI-provider tab blocks its whole render on. They are
 * throttled per endpoint (60/60s per IP, shared by the entire single-worker
 * run), so a test that loads the tab repeatedly must not spend that budget (#516).
 */
async function serveAiTabReads(page: Page): Promise<void> {
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
					activeProvider: null,
					providers: {},
					harness: "auto",
				}),
			});
		},
	);
	await page.route(
		(url) => url.pathname === "/api/settings/llm/env-status",
		async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					providers: Object.fromEntries(
						Object.values(LLM_PROVIDERS).map((provider) => [
							provider.id,
							{
								hasApiKey: false,
								envVarName: provider.envVar,
								isReady: !provider.requiresApiKey,
							},
						]),
					),
					activeEnvProvider: null,
				}),
			});
		},
	);
}

async function openAiSettings(page: Page): Promise<void> {
	await page.goto("/settings?tab=ai");
	await expect(
		page.getByRole("heading", { name: "Investigation agent", exact: true }),
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

		await expect(
			card(page).getByText("Signed-in Claude session", { exact: true }),
		).toBeVisible();
		// deepagents-acp is absent on this fixture machine, so the badge names the
		// gap it actually has (#518) rather than a credential it does not need yet.
		await expect(
			card(page).getByText("Not installed", { exact: true }),
		).toBeVisible();
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

		await expect(card(page).getByText(CLAUDE_NOT_INSTALLED)).toBeVisible();
		await expect(card(page).getByText(DEEPAGENTS_NOT_INSTALLED)).toBeVisible();
		// #518: the advice a machine with no Claude CLI must never be given.
		await expect(card(page).getByText("claude /login")).toHaveCount(0);
	});

	test("distinguishes a missing binary from a missing key (#518)", async ({
		page,
	}) => {
		await serveHarnesses(page, INSTALLED_BUT_UNAUTHENTICATED);
		await openAiSettings(page);

		await expect(
			card(page).getByText("Not authenticated", { exact: true }),
		).toBeVisible();
		await expect(
			card(page).getByText("Not installed", { exact: true }),
		).toHaveCount(0);
		await expect(
			card(page).getByText(DEEPAGENTS_NOT_AUTHENTICATED, { exact: true }),
		).toBeVisible();
	});

	test("badges a missing binary as not installed (#518)", async ({ page }) => {
		await serveHarnesses(page, NOTHING);
		await openAiSettings(page);

		await expect(
			card(page).getByText("Not installed", { exact: true }),
		).toHaveCount(2);
	});

	test("disables an agent that cannot run, and keeps its reason on screen", async ({
		page,
	}) => {
		await serveHarnesses(page, SESSION_ONLY);
		await openAiSettings(page);

		await expect(
			page.getByRole("radio", { name: "deepagents (ACP)" }),
		).toBeDisabled();
		await expect(
			page.getByRole("radio", { name: "Claude Code (Agent SDK)" }),
		).toBeEnabled();
		await expect(page.getByRole("radio", { name: "Auto (recommended)" })).toBeEnabled();
		await expect(card(page).getByText(DEEPAGENTS_NOT_INSTALLED)).toBeVisible();
	});

	test("states plainly at the surface when no agent is available", async ({
		page,
	}) => {
		await serveHarnesses(page, NOTHING);
		await openAiSettings(page);

		const banner = page.getByTestId("harness-none-available");
		await expect(banner).toBeVisible();
		await expect(banner).toContainText(
			"No investigation agent is available on this machine",
		);
		// A statement, not a nudge — an install prompt is an operator decision.
		await expect(banner.getByRole("link")).toHaveCount(0);
		await expect(banner.getByRole("button")).toHaveCount(0);
	});

	test("says nothing at the surface while an agent can still run", async ({
		page,
	}) => {
		await serveHarnesses(page, SESSION_ONLY);
		await openAiSettings(page);

		await expect(page.getByTestId("harness-none-available")).toHaveCount(0);
	});

	// The row is disabled, so this state is only reachable by an agent that was
	// pinned while it worked and has since gone away — exactly when it matters.
	test("warns when the SAVED harness can no longer run", async ({ page }) => {
		await serveActiveProvider(page, "anthropic", "claude-code");
		await serveHarnesses(page, NOTHING);
		await openAiSettings(page);

		const warning = page.getByTestId("harness-warning");
		await expect(warning).toBeVisible();
		await expect(warning).toContainText("is not installed on this machine");
		await expect(warning).toContainText(CLAUDE_NOT_INSTALLED);
	});

	// A pinned claude-code on a cli-session route is provider-agnostic and the gate
	// says so, so the card must stay quiet. Round 1's false warning lived here.
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

	/**
	 * Each state gets its own navigation with its fixture already in place.
	 * Chaining `page.reload()` through four different fixtures was flaky under
	 * parallel load — a fresh goto per state is both stabler and closer to what a
	 * reader actually opens.
	 */
	test("settings card: default, dark, empty and error states", async ({
		page,
		baseURL,
	}) => {
		test.setTimeout(120_000);

		await serveAiTabReads(page);

		// addCookies, not `document.cookie` from a loaded page: the old bootstrap
		// navigation answered from the real machine and spent throttle budget the
		// four states need (#516). clearCookies would drop the storageState session.
		const themeOnly = async (theme: "light" | "dark") => {
			await page.context().addCookies([
				{
					name: "prismalens-theme",
					value: theme,
					url: baseURL as string,
				},
			]);
		};

		const shot = async (
			name: string,
			theme: "light" | "dark",
			harnesses: HarnessFixture[] | "error",
			ready: () => Promise<void>,
		) => {
			await themeOnly(theme);
			if (harnesses === "error") await failHarnesses(page);
			else await serveHarnesses(page, harnesses);
			await page.goto("/settings?tab=ai");
			await expect(page.locator("html")).toHaveClass(new RegExp(theme));
			await ready();
			await page.waitForLoadState("networkidle");
			await card(page).screenshot({ path: `${SHOTS}/${name}.png` });
			await page.unroute(isHarnessesUrl);
		};

		const sessionReady = async () => {
			await expect(
				card(page).getByText("Signed-in Claude session", { exact: true }),
			).toBeVisible({ timeout: 15_000 });
		};

		await shot("settings-harness-default", "light", SESSION_ONLY, sessionReady);
		await shot("settings-harness-dark", "dark", SESSION_ONLY, sessionReady);

		// "Empty" for this card is a machine holding no agent at all — the state a
		// fresh install is in, and the one #501 and #518 were both reported from.
		await shot("settings-harness-empty", "light", NOTHING, async () => {
			await expect(page.getByTestId("harness-none-available")).toBeVisible({
				timeout: 15_000,
			});
		});

		await shot("settings-harness-error", "light", "error", async () => {
			await expect(page.getByTestId("harness-status-error")).toBeVisible({
				timeout: 20_000,
			});
		});
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
