// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";

/**
 * Investigation-agent surface (#501, ADR-0031; narrowed by #337/#609/#523).
 *
 * The AI-provider card, its per-provider credential UI, and the raw-report
 * banner are gone — there is no LLM router any more. What is left is
 * `GET /settings/harnesses` (ADR 0003 §9): a registry row per harness
 * (installed on this machine, and the version CI tested) plus the gate's own selection
 * verdict, rendered verbatim. The picker below it is LIVE: it reads and
 * writes `GET`/`PATCH /settings/harness`, the persisted choice and model —
 * `PRISMALENS_HARNESS`, when set, still wins at investigation time
 * (`selection.pinned`), which the card says plainly rather than disabling
 * the picker.
 *
 * Every verdict here is served from a fixture rather than the machine running
 * the suite, so a CI box and a developer machine assert the same thing.
 */

const SHOTS = "e2e/journeys/screenshots";

type HarnessFixture = {
	id: string;
	label: string;
	binary: string;
	installed: boolean;
	install: string;
	defaultModel: string | null;
	tested: { version: string; date: string } | null;
	modelVia: "config" | "env" | "unsupported";
	loginHint: string;
};

const CLAUDE_INSTALLED: HarnessFixture = {
	id: "claude-code",
	label: "Claude Code",
	binary: "claude-agent-acp",
	installed: true,
	install: "npm i -g @agentclientprotocol/claude-agent-acp  (set ANTHROPIC_API_KEY)",
	defaultModel: null,
	tested: null,
	modelVia: "env",
	loginHint:
		"`claude /login`, or `ANTHROPIC_API_KEY` in env",
};

const OPENCODE_INSTALLED: HarnessFixture = {
	id: "opencode",
	label: "OpenCode",
	binary: "opencode",
	installed: true,
	install: "curl -fsSL https://opencode.ai/install | bash  (or: npm i -g opencode-ai)",
	defaultModel: null,
	tested: { version: "1.18.30", date: "2026-09-20" },
	modelVia: "config",
	loginHint:
		"Keyless default model; `opencode auth login` or a provider key in env for others",
};

const CODEX_INSTALLED: HarnessFixture = {
	id: "codex",
	label: "Codex",
	binary: "codex-acp",
	installed: true,
	install: "npm i -g @agentclientprotocol/codex-acp  (set OPENAI_API_KEY)",
	defaultModel: null,
	tested: null,
	modelVia: "unsupported",
	loginHint: "`OPENAI_API_KEY` in env (the CLI login is not visible to the run)",
};

const DEEPAGENTS_MISSING: HarnessFixture = {
	id: "deepagents",
	label: "deepagents",
	binary: "deepagents-acp",
	installed: false,
	install: "pip install deepagents-acp",
	defaultModel: null,
	tested: null,
	modelVia: "unsupported",
	loginHint: "`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in env",
};

/** A machine with opencode (CI-tested, on PATH), claude-code and codex (both
 * installed, untested), and deepagents missing. */
const RUNNABLE: HarnessFixture[] = [
	OPENCODE_INSTALLED,
	CLAUDE_INSTALLED,
	CODEX_INSTALLED,
	DEEPAGENTS_MISSING,
];

/** The falsifier machine: no harness binary anywhere. */
const NOTHING: HarnessFixture[] = [
	{ ...OPENCODE_INSTALLED, installed: false },
	{ ...CLAUDE_INSTALLED, installed: false },
	DEEPAGENTS_MISSING,
];

const NO_HARNESS_REASON =
	"No coding agent found on PATH. Install one: OpenCode: curl -fsSL https://opencode.ai/install | bash  (or: npm i -g opencode-ai); Claude Code: npm i -g @agentclientprotocol/claude-agent-acp  (set ANTHROPIC_API_KEY); Codex: npm i -g @agentclientprotocol/codex-acp  (set OPENAI_API_KEY); Gemini CLI: npm i -g @google/gemini-cli; deepagents: pip install deepagents-acp.";

const isHarnessesUrl = (url: URL) => url.pathname === "/api/settings/harnesses";

async function serveHarnesses(
	page: Page,
	harnesses: HarnessFixture[],
	selection: {
		runnable: boolean;
		harness: string | null;
		pinned: boolean;
		pinnedBy?: "env" | "settings" | null;
		blockedReason: string | null;
	},
): Promise<void> {
	await page.route(isHarnessesUrl, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ harnesses, selection }),
		});
	});
}

async function failHarnesses(page: Page): Promise<void> {
	await page.route(isHarnessesUrl, async (route) => {
		await route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({
				code: "INTERNAL_SERVER_ERROR",
				message: "harness status unavailable",
				status: 500,
			}),
		});
	});
}

const isHarnessSettingsUrl = (url: URL) => url.pathname === "/api/settings/harness";

/** The persisted harness choice `GET /settings/harness` answers with. */
async function serveHarnessSettings(
	page: Page,
	settings: { harness: string; model?: string },
): Promise<void> {
	let current = { ...settings };
	await page.route(isHarnessSettingsUrl, async (route) => {
		if (route.request().method() === "PATCH") {
			const body = (route.request().postDataJSON() || {}) as Record<string, unknown>;
			current = { ...current, ...body } as typeof current;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(current),
			});
			return;
		}
		if (route.request().method() === "GET") {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(current),
			});
			return;
		}
		await route.fallback();
	});
}

async function openHarnessSettings(
	page: Page,
	settings: { harness: string; model?: string } = { harness: "auto" },
): Promise<void> {
	await serveHarnessSettings(page, settings);
	await page.goto("/settings?tab=harness");
	await expect(
		page.getByRole("heading", { name: "Agent", exact: true }),
	).toBeVisible({ timeout: 15_000 });
}

const card = (page: Page) => page.getByTestId("harness-settings");

test.describe("Investigation agent settings card (#501/#609)", () => {
	test("lists every registry harness with its installed badge", async ({
		page,
	}) => {
		await serveHarnesses(page, RUNNABLE, {
			runnable: true,
			harness: "opencode",
			pinned: false,
			pinnedBy: null,
			blockedReason: null,
		});
		await openHarnessSettings(page);

		const registry = page.getByTestId("harness-registry");
		// The opencode row's own login hint contains the string "opencode"
		// (the binary name), so a plain case-insensitive getByText("OpenCode")
		// resolves to two elements. Scope to the label span, which is the only
		// element carrying exactly these three utility classes together.
		await expect(
			registry.locator("span.flex.items-center.gap-2").filter({ hasText: "OpenCode" }),
		).toBeVisible();
		await expect(
			registry.getByText("Claude Code"),
		).toBeVisible();
		await expect(registry.getByText("Codex")).toBeVisible();
		// Same collision as opencode above: the binary "deepagents-acp" and the
		// install hint "pip install deepagents-acp" both contain "deepagents".
		await expect(
			registry.locator("span.flex.items-center.gap-2").filter({ hasText: "deepagents" }),
		).toBeVisible();
		await expect(registry.getByText("installed", { exact: true })).toHaveCount(3);
		await expect(
			registry.getByText("not installed", { exact: true }),
		).toHaveCount(1);
	});

	test("shows the tested version and sign-in per row, and disables the Model field for a harness that ignores it (#634)", async ({
		page,
	}) => {
		await serveHarnesses(page, RUNNABLE, {
			runnable: true,
			harness: "opencode",
			pinned: false,
			pinnedBy: null,
			blockedReason: null,
		});
		await openHarnessSettings(page);

		const registry = page.getByTestId("harness-registry");
		await expect(registry.getByTestId("harness-tested-opencode")).toHaveText(
			"tested 1.18.30",
		);
		await expect(
			registry.getByTestId("harness-tested-claude-code"),
		).toHaveCount(0);
		await expect(registry.getByText(OPENCODE_INSTALLED.loginHint, {
			exact: false,
		})).toBeVisible();

		const modelPill = page.getByTestId("model-pill");
		await expect(modelPill).toBeEnabled();

		await page.getByTestId("agent-picker").click();
		await page.getByTestId("agent-option-codex").click();
		await expect(modelPill).toBeDisabled();
	});

	test("shows the install hint for a harness that is not installed", async ({
		page,
	}) => {
		await serveHarnesses(page, NOTHING, {
			runnable: false,
			harness: null,
			pinned: false,
			pinnedBy: null,
			blockedReason: NO_HARNESS_REASON,
		});
		await openHarnessSettings(page);

		await expect(
			page.getByTestId("harness-registry").getByText("pip install deepagents-acp"),
		).toBeVisible();
	});

	test("renders the gate's selection verdict verbatim, auto-selected", async ({
		page,
	}) => {
		await serveHarnesses(page, RUNNABLE, {
			runnable: true,
			harness: "opencode",
			pinned: false,
			pinnedBy: null,
			blockedReason: null,
		});
		await openHarnessSettings(page);

		const verdict = page.getByTestId("harness-selection");
		await expect(verdict).toContainText("Would start with OpenCode");
		await expect(verdict).toContainText("ready");
		await expect(page.getByTestId("harness-pinned-notice")).toHaveCount(0);
	});

	test("shows a notice that PRISMALENS_HARNESS overrides the picker when pinned", async ({
		page,
	}) => {
		await serveHarnesses(page, RUNNABLE, {
			runnable: true,
			harness: "claude-code",
			pinned: true,
			pinnedBy: "env",
			blockedReason: null,
		});
		await openHarnessSettings(page);

		const verdict = page.getByTestId("harness-selection");
		await expect(verdict).toContainText("Would start with Claude Code");
		await expect(page.getByTestId("harness-pinned-notice")).toContainText(
			"PRISMALENS_HARNESS",
		);
	});

	test("states plainly when no harness is available, with the server's reason", async ({
		page,
	}) => {
		await serveHarnesses(page, NOTHING, {
			runnable: false,
			harness: null,
			pinned: false,
			pinnedBy: null,
			blockedReason: NO_HARNESS_REASON,
		});
		await openHarnessSettings(page);

		const banner = page.getByTestId("harness-none-available");
		await expect(banner).toBeVisible();

		const verdict = page.getByTestId("harness-selection");
		await expect(verdict).toContainText("blocked");
		await expect(verdict).toContainText(NO_HARNESS_REASON);
	});

	test("keeps the card usable when the status endpoint fails", async ({
		page,
	}) => {
		await failHarnesses(page);
		await openHarnessSettings(page);

		await expect(page.getByTestId("harness-status-error")).toBeVisible({
			timeout: 15_000,
		});
	});

	test("saves the picked harness and model through PATCH /settings/harness", async ({
		page,
	}) => {
		await serveHarnesses(page, RUNNABLE, {
			runnable: true,
			harness: "opencode",
			pinned: false,
			pinnedBy: null,
			blockedReason: null,
		});
		await openHarnessSettings(page, { harness: "auto" });

		const patches: Record<string, unknown>[] = [];
		let current: { harness: string; model?: string } = { harness: "auto" };
		await page.route(isHarnessSettingsUrl, async (route) => {
			if (route.request().method() === "PATCH") {
				const body = route.request().postDataJSON() as Record<string, unknown>;
				patches.push(body);
				current = { ...current, ...body };
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(current),
				});
				return;
			}
			if (route.request().method() === "GET") {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(current),
				});
				return;
			}
			await route.fallback();
		});

		// Pick agent through agent-picker -> agent-option-opencode (saves at once)
		await page.getByTestId("agent-picker").click();
		await page.getByTestId("agent-option-opencode").click();
		await expect.poll(() => patches.length).toBeGreaterThanOrEqual(1);
		expect(patches[0]).toMatchObject({ harness: "opencode" });

		// Set model through model-pill -> input Model -> Use
		await page.getByTestId("model-pill").click();
		const modelInput = page.getByLabel("Model");
		await expect(modelInput).toBeVisible();
		await modelInput.fill("sonnet-4");
		await page.getByRole("button", { name: "Use", exact: true }).click();
		await expect.poll(() => patches.length).toBeGreaterThanOrEqual(2);
		expect(patches[1]).toMatchObject({ model: "sonnet-4" });
		await expect(page.getByTestId("model-pill")).toContainText("sonnet-4");
	});

	test("checks one harness's ACP handshake on demand and shows the verdict verbatim (#630)", async ({
		page,
	}) => {
		await serveHarnesses(page, RUNNABLE, {
			runnable: true,
			harness: "opencode",
			pinned: false,
			pinnedBy: null,
			blockedReason: null,
		});
		await openHarnessSettings(page);

		await page.route(
			(url) => url.pathname === "/api/settings/harness/check",
			async (route) => {
				const body = route.request().postDataJSON();
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(
						body?.id === "opencode"
							? {
									id: "opencode",
									outcome: "answers-acp",
									detail: "answers ACP",
									hard: false,
								}
							: {
									id: "claude-code",
									outcome: "sign-in-needed",
									detail: "sign in needed (Log in with Claude)",
									hard: false,
								},
					),
				});
			},
		);

		await page.getByTestId("harness-check-opencode").click();
		await expect(page.getByTestId("harness-check-result-opencode")).toHaveText(
			"answers ACP",
		);

		await page.getByTestId("harness-check-claude-code").click();
		await expect(
			page.getByTestId("harness-check-result-claude-code"),
		).toHaveText("sign in needed (Log in with Claude)");
	});
});

/**
 * Design evidence for the frontend gate (AGENTS.md). Element-scoped rather than
 * full-page: the changed surface is the card, and a narrow frame keeps the
 * committed PNGs clear of the chrome around it.
 */
test.describe("Design evidence (#501/#609)", () => {
	test("settings card: default, dark, empty and error states", async ({
		page,
		baseURL,
	}) => {
		test.setTimeout(90_000);

		await serveHarnessSettings(page, { harness: "auto" });

		const themeOnly = async (theme: "light" | "dark") => {
			await page.context().addCookies([
				{ name: "prismalens-theme", value: theme, url: baseURL as string },
			]);
		};

		const shot = async (
			name: string,
			theme: "light" | "dark",
			harnesses: HarnessFixture[] | "error",
		) => {
			await themeOnly(theme);
			if (harnesses === "error") {
				await failHarnesses(page);
			} else {
				await serveHarnesses(page, harnesses, {
					runnable: harnesses === RUNNABLE,
					harness: harnesses === RUNNABLE ? "opencode" : null,
					pinned: false,
					pinnedBy: null,
					blockedReason: harnesses === RUNNABLE ? null : NO_HARNESS_REASON,
				});
			}
			await page.goto("/settings?tab=harness");
			await expect(page.locator("html")).toHaveClass(new RegExp(theme));
			await expect(card(page)).toBeVisible({ timeout: 15_000 });
			await page.waitForTimeout(500);
			await card(page).screenshot({ path: `${SHOTS}/${name}.png` });
			await page.unroute(isHarnessesUrl);
		};

		await shot("settings-harness-default", "light", RUNNABLE);
		await shot("settings-harness-dark", "dark", RUNNABLE);
		await shot("settings-harness-empty", "light", NOTHING);
		await shot("settings-harness-error", "light", "error");
	});
});
