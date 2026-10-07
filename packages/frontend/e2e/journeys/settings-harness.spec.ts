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
	models: {
		source: "harness" | "catalogue";
		asOf: string;
		entries: { id: string; name: string; status: string | null }[];
	};
};

const NO_MODELS: HarnessFixture["models"] = {
	source: "catalogue",
	asOf: "2026-09-23T00:00:00Z",
	entries: [],
};

const CLAUDE_INSTALLED: HarnessFixture = {
	id: "claude-code",
	label: "Claude Code",
	binary: "claude-agent-acp",
	installed: true,
	install:
		"npm i -g @agentclientprotocol/claude-agent-acp  (set ANTHROPIC_API_KEY)",
	defaultModel: null,
	tested: null,
	modelVia: "env",
	loginHint: "`claude /login`, or `ANTHROPIC_API_KEY` in env",
	models: NO_MODELS,
};

// Synthetic ids: the fixture proves the picker's behaviour, not the catalogue's contents.
const OPENCODE_MODELS: HarnessFixture["models"] = {
	source: "catalogue",
	asOf: "2026-09-23T00:00:00Z",
	entries: [
		{
			id: "vendor/fixture-current",
			name: "Fixture Current",
			status: "current",
		},
		{ id: "vendor/fixture-old", name: "Fixture Old", status: "legacy" },
	],
};

const OPENCODE_INSTALLED: HarnessFixture = {
	id: "opencode",
	label: "OpenCode",
	binary: "opencode",
	installed: true,
	install:
		"curl -fsSL https://opencode.ai/install | bash  (or: npm i -g opencode-ai)",
	defaultModel: null,
	tested: { version: "1.18.30", date: "2026-09-20" },
	modelVia: "config",
	loginHint: "`opencode auth login`, or a provider key in env",
	models: OPENCODE_MODELS,
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
	loginHint: "`codex login`, or `OPENAI_API_KEY` in env",
	models: NO_MODELS,
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
	models: NO_MODELS,
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
	"No coding agent on this machine. Install one: OpenCode: curl -fsSL https://opencode.ai/install | bash  (or: npm i -g opencode-ai); Claude Code: npm i -g @agentclientprotocol/claude-agent-acp  (set ANTHROPIC_API_KEY); Codex: npm i -g @agentclientprotocol/codex-acp  (set OPENAI_API_KEY); Gemini CLI: npm i -g @google/gemini-cli; deepagents: pip install deepagents-acp.";

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

const isHarnessSettingsUrl = (url: URL) =>
	url.pathname === "/api/settings/harness";

/** The persisted harness choice `GET /settings/harness` answers with. */
async function serveHarnessSettings(
	page: Page,
	settings: { harness: string; models?: Record<string, string | null> },
): Promise<void> {
	let current = { ...settings };
	await page.route(isHarnessSettingsUrl, async (route) => {
		if (route.request().method() === "PATCH") {
			const body = (route.request().postDataJSON() || {}) as Record<
				string,
				unknown
			>;
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
	settings: { harness: string; models?: Record<string, string | null> } = {
		harness: "auto",
	},
): Promise<void> {
	await serveHarnessSettings(page, settings);
	await page.goto("/settings?tab=harness");
	await expect(
		page.getByRole("heading", { name: "Agent", exact: true }),
	).toBeVisible({ timeout: 15_000 });
}

const card = (page: Page) => page.getByTestId("harness-settings");

test.describe("Investigation agent settings card (#501/#609)", () => {
	test("lists every registry harness, marking the one not installed", async ({
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
		for (const h of [OPENCODE_INSTALLED, CLAUDE_INSTALLED, CODEX_INSTALLED]) {
			const row = registry.getByTestId(`harness-row-${h.id}`);
			await expect(row).toContainText(h.label);
			await expect(row).not.toContainText("not installed");
		}
		await expect(registry.getByTestId("harness-row-deepagents")).toContainText(
			"not installed",
		);
		await expect(
			registry.getByText("not installed", { exact: true }),
		).toHaveCount(1);
	});

	test("shows the tested version and sign-in per row, and no model list for a harness that has not been checked (#634)", async ({
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
			"1.18.30",
		);
		await expect(
			registry.getByTestId("harness-tested-claude-code"),
		).toHaveCount(0);
		// The hint renders its backticked spans as code, so match the text without them.
		await expect(
			registry.getByText(OPENCODE_INSTALLED.loginHint.replaceAll("`", ""), {
				exact: false,
			}),
		).toBeVisible();
		await expect(
			registry.locator("code", { hasText: "opencode auth login" }),
		).toBeVisible();

		// OpenCode takes a model: the picker lists Agent default and its models.
		// The chip never reads a bare "Agent default" (#673 w7).
		await expect(page.getByTestId("model-pill")).toHaveText("OpenCode default");
		await page.getByTestId("agent-picker").click();
		const list = page.getByTestId("agent-picker-list");
		await expect(list.getByTestId("model-default")).toBeVisible();

		// Codex takes its model by its own settings until a check says otherwise:
		// Agent default and a line asking for a check, no models.
		await list.getByTestId("rail-codex").click();
		await expect(list.getByTestId("model-pending")).toBeVisible();
		await expect(list.getByTestId("model-default")).toHaveCount(1);
		await expect(list.getByTestId("model-option")).toHaveCount(0);
	});

	test("offers only Agent default for a model stored for a harness that cannot take one (#639)", async ({
		page,
	}) => {
		await serveHarnesses(page, RUNNABLE, {
			runnable: false,
			harness: "codex",
			pinned: true,
			pinnedBy: "settings",
			blockedReason:
				"Codex picks its own model. Clear vendor/stale in the picker above.",
		});
		await openHarnessSettings(page, {
			harness: "codex",
			models: { codex: "vendor/stale" },
		});

		await expect(page.getByTestId("harness-run-row")).toContainText(
			"Codex picks its own model",
		);
		// A model stored for an agent that cannot take one: Agent default, which
		// clears it, is the only choice in the model list (#673 replaced Clear).
		await page.getByTestId("agent-picker").click();
		const list = page.getByTestId("agent-picker-list");
		await expect(list.getByRole("option")).toHaveCount(1);
		await list.getByTestId("model-default").click();
		await expect(list).toHaveCount(0);
	});

	test("works from the keyboard: Enter clears a blocking model with Agent default, picks a starred row, and toggles a star (#781 review)", async ({
		page,
	}) => {
		await serveHarnesses(page, RUNNABLE, {
			runnable: false,
			harness: "codex",
			pinned: true,
			pinnedBy: "settings",
			blockedReason:
				"Codex picks its own model. Clear vendor/stale in the picker above.",
		});
		const patches: Record<string, unknown>[] = [];
		let current: Record<string, unknown> = {
			harness: "codex",
			models: { codex: "vendor/stale" },
			// deepagents is not installed; its star must not be pickable.
			favourites: [
				{ harness: "deepagents", model: "vendor/ghost" },
				{ harness: "opencode", model: "vendor/fixture-current" },
			],
		};
		await page.route(isHarnessSettingsUrl, async (route) => {
			if (route.request().method() === "PATCH") {
				const body = route.request().postDataJSON() as Record<string, unknown>;
				patches.push(body);
				current = { ...current, ...body };
			}
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(current),
			});
		});
		await page.goto("/settings?tab=harness");
		await expect(
			page.getByRole("heading", { name: "Agent", exact: true }),
		).toBeVisible({ timeout: 15_000 });
		const picker = page.getByTestId("agent-picker");
		const list = page.getByTestId("agent-picker-list");

		// Agent default, which clears the stored model, is the cursor's first stop.
		await picker.click();
		await expect(list.getByTestId("model-default")).toBeVisible({
			timeout: 15_000,
		});
		await page.keyboard.press("Enter");
		await expect.poll(() => patches.length).toBe(1);
		expect(patches[0]).toEqual({ harness: "codex", models: { codex: null } });
		await expect(list).toHaveCount(0);

		// Starred lists installed agents only, and Enter picks its row.
		await picker.click();
		await list.getByTestId("rail-starred").click();
		await expect(list.getByTestId("model-option")).toHaveCount(1);
		await expect(list.getByTestId("model-option")).toContainText(
			"Fixture Current",
		);
		await list.getByTestId("picker-search").focus();
		await page.keyboard.press("Enter");
		await expect.poll(() => patches.length).toBe(2);
		expect(patches[1]).toEqual({
			harness: "opencode",
			models: { opencode: "vendor/fixture-current" },
		});
		await expect(list).toHaveCount(0);

		// A focused star toggles on Enter.
		await picker.click();
		await list.getByTestId("rail-opencode").click();
		await list
			.locator('[data-testid=model-option][data-model="Fixture Old"]')
			.getByTestId("model-star")
			.focus();
		await page.keyboard.press("Enter");
		await expect.poll(() => patches.length).toBe(3);
		expect(patches[2]).toEqual({
			favourites: [
				{ harness: "deepagents", model: "vendor/ghost" },
				{ harness: "opencode", model: "vendor/fixture-current" },
				{ harness: "opencode", model: "vendor/fixture-old" },
			],
		});
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
			page
				.getByTestId("harness-registry")
				.getByText("pip install deepagents-acp"),
		).toBeVisible();
	});

	test("names the agent the gate would start, auto-selected", async ({
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

		await expect(page.getByTestId("agent-picker")).toHaveAttribute(
			"aria-label",
			/^Agent and model: OpenCode, /,
		);
		await expect(page.getByTestId("harness-run-row")).toContainText(
			"The same control sits in the box on an incident",
		);
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

		await expect(page.getByTestId("agent-picker")).toHaveAttribute(
			"aria-label",
			/^Agent and model: Claude Code, /,
		);
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

		await expect(page.getByTestId("harness-none-available")).toBeVisible();
		// The gate's reason, verbatim, under the next run's agent.
		await expect(page.getByTestId("harness-run-row")).toContainText(
			NO_HARNESS_REASON,
		);
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

	test("stops at a 429 instead of retrying it, and shows the error (#527)", async ({
		page,
	}) => {
		let calls = 0;
		await page.route(isHarnessesUrl, async (route) => {
			calls++;
			await route.fulfill({
				status: 429,
				contentType: "application/json",
				headers: { "retry-after": "60" },
				body: JSON.stringify({
					code: "TOO_MANY_REQUESTS",
					message: "ThrottlerException: Too Many Requests",
					status: 429,
				}),
			});
		});
		await openHarnessSettings(page);

		await expect(page.getByTestId("harness-status-error")).toBeVisible();
		// Every mount issues one request; none of them is a retry.
		await page.waitForTimeout(1_500);
		const mounted = calls;
		await page.waitForTimeout(2_000);
		expect(calls).toBe(mounted);
		expect(calls).toBeLessThanOrEqual(2);
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
		let current: { harness: string; models?: Record<string, string | null> } = {
			harness: "auto",
		};
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

		// A model chosen under an agent saves both at once, by name.
		await page.getByTestId("agent-picker").click();
		const list = page.getByTestId("agent-picker-list");
		await list.getByTestId("rail-opencode").click();
		await list
			.getByTestId("model-option")
			.filter({ hasText: "Fixture Current" })
			.click();
		await expect.poll(() => patches.length).toBe(1);
		expect(patches[0]).toEqual({
			harness: "opencode",
			models: { opencode: "vendor/fixture-current" },
		});
		await expect(page.getByTestId("model-pill")).toHaveText("Fixture Current");
	});

	test("lists the agent's models by name, marks a legacy one, and keeps a stored id it does not know (#639, #743)", async ({
		page,
	}) => {
		await serveHarnesses(page, RUNNABLE, {
			runnable: true,
			harness: "opencode",
			pinned: false,
			pinnedBy: null,
			blockedReason: null,
		});
		await openHarnessSettings(page, {
			harness: "opencode",
			models: { opencode: "vendor/typed-by-hand" },
		});

		// A stored id the list does not know reads as the id.
		await expect(page.getByTestId("model-pill")).toHaveText(
			"vendor/typed-by-hand",
		);
		await page.getByTestId("agent-picker").click();
		const list = page.getByTestId("agent-picker-list");
		const models = list.getByRole("listbox", { name: "Models" });
		await expect(models).toContainText("Fixture Current");
		await expect(models).toContainText("legacy");
		await expect(models).toContainText("Not confirmed for OpenCode");
		// Search filters the agent's list; it is no field to type an id into (#743 §4.1).
		await list.getByTestId("picker-search").fill("vendor/brand-new");
		await expect(models).toContainText("No model matches.");
		await expect(list.getByTestId("model-option")).toHaveCount(0);
		await list.getByTestId("picker-search").fill("");

		await list
			.getByTestId("model-option")
			.filter({ hasText: "Fixture Current" })
			.click();
		await expect(page.getByTestId("model-pill")).toHaveText("Fixture Current");
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
			await page
				.context()
				.addCookies([
					{ name: "prismalens-theme", value: theme, url: baseURL as string },
				]);
		};

		const renderCard = async (
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
			await page.unroute(isHarnessesUrl);
		};

		await renderCard("light", RUNNABLE);
		await renderCard("dark", RUNNABLE);
		await renderCard("light", NOTHING);
		await renderCard("light", "error");
	});
});
