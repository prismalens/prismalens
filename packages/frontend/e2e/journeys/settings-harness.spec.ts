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
	modelVia: "config" | "env" | "unsupported" | "acp";
	loginHint: string;
	localDefault?: {
		permission: {
			level: string | null;
			file: string;
			value: string;
			reason?: string;
		} | null;
	} | null;
	checked?: {
		at: string;
		outcome: string;
		detail: string;
		servedModel: string | null;
		effort: unknown;
		modes?: { id: string; name: string }[] | null;
		efforts?: unknown;
		images: boolean;
		sandbox?: unknown;
	} | null;
	models: {
		source: "harness" | "catalogue";
		asOf: string;
		entries: {
			id: string;
			name: string;
			status: string | null;
			description?: string;
		}[];
	};
	envVars?: { name: string; state: "unset" | "set" | "env" }[];
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
			body: JSON.stringify({ harnesses: withRunnable(harnesses), selection }),
		});
	});
}

/** The #907 fields a fixture leaves out: it can run when installed and its last check, if any, answered. */
function withRunnable(harnesses: HarnessFixture[]) {
	return harnesses.map((h) => ({
		runnable:
			h.installed && (!h.checked || h.checked.outcome === "answers-acp"),
		cliBinary: h.binary,
		configDir: null,
		providerKeys: [],
		envVars: [],
		...h,
	}));
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

type SettingsFixture = {
	harness: string;
	models?: Record<string, string | null>;
	efforts?: Record<string, string | null>;
	accessLevels?: Record<string, string | null>;
	favourites?: { harness: string; model: string }[];
	hiddenModels?: Record<string, string[] | null>;
	modelOrder?: Record<string, string[] | null>;
	envNames?: Record<string, string[]>;
};

/** The persisted harness choice `GET /settings/harness` answers with. */
async function serveHarnessSettings(
	page: Page,
	settings: SettingsFixture,
	patches: Record<string, unknown>[] = [],
): Promise<void> {
	let current = { ...settings };
	await page.route(isHarnessSettingsUrl, async (route) => {
		if (route.request().method() === "PATCH") {
			const { env, ...body } = (route.request().postDataJSON() || {}) as Record<
				string,
				unknown
			>;
			patches.push(env ? { ...body, env } : body);
			// The server keeps values and answers names only (#907).
			const names = { ...current.envNames };
			for (const [id, rows] of Object.entries(
				(env ?? {}) as Record<string, Record<string, string | null>>,
			))
				names[id] = Object.entries(rows)
					.filter(([, v]) => v !== null)
					.map(([n]) => n);
			current = {
				...current,
				...body,
				envNames: names,
				hiddenModels: {
					...current.hiddenModels,
					...(body.hiddenModels as Record<string, string[] | null> | undefined),
				},
				modelOrder: {
					...current.modelOrder,
					...(body.modelOrder as Record<string, string[] | null> | undefined),
				},
				models: {
					...current.models,
					...(body.models as Record<string, string | null> | undefined),
				},
				efforts: {
					...current.efforts,
					...(body.efforts as Record<string, string | null> | undefined),
				},
				accessLevels: {
					...current.accessLevels,
					...(body.accessLevels as Record<string, string | null> | undefined),
				},
			} as typeof current;
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
	settings: SettingsFixture = {
		harness: "auto",
	},
): Promise<void> {
	await serveHarnessSettings(page, settings);
	await page.goto("/settings?tab=agent");
	await expect(
		page.getByRole("heading", { name: "Agent", exact: true }),
	).toBeVisible({ timeout: 15_000 });
}

const card = (page: Page) => page.getByTestId("harness-settings");

test.describe("Investigation agent settings card (#501/#609)", () => {
	test("only runnable agents are listed; one warning when none can run (#907)", async ({
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
			await expect(row.getByTestId(`harness-open-${h.id}`)).toHaveAttribute(
				"href",
				`/settings?tab=agent&agent=${h.id}`,
			);
		}
		await expect(registry.getByTestId("harness-row-deepagents")).toHaveCount(0);
		await expect(registry.getByText("not installed")).toHaveCount(0);
		await expect(registry.getByTestId("harness-add-agent")).toBeVisible();
		await expect(page.getByTestId("harness-none-available")).toHaveCount(0);

		await page.unroute(isHarnessesUrl);
		await serveHarnesses(page, NOTHING, {
			runnable: false,
			harness: null,
			pinned: false,
			pinnedBy: null,
			blockedReason: NO_HARNESS_REASON,
		});
		await page.reload();
		await expect(page.getByTestId("harness-none-available")).toHaveText(
			"No agent can run. Add one to start investigations.",
		);
		await expect(registry.locator('[data-testid^="harness-row-"]')).toHaveCount(
			0,
		);
	});

	test("no Default row: the agent's own default shows as the model it runs (#902 f10, #907)", async ({
		page,
	}) => {
		const claude: HarnessFixture = {
			...CLAUDE_INSTALLED,
			modelVia: "acp",
			models: {
				source: "harness",
				asOf: "2026-10-23T00:00:00Z",
				entries: [
					{
						id: "default",
						name: "Default (recommended)",
						status: null,
						description: "Fixture Opus",
					},
					{ id: "fixture-sonnet", name: "Fixture Sonnet", status: null },
					{ id: "fixture-opus", name: "Fixture Opus", status: null },
				],
			},
			checked: {
				at: "2026-10-23T00:00:00Z",
				outcome: "answers-acp",
				detail: "answers ACP",
				servedModel: "default",
				effort: null,
				images: false,
			},
		};
		await serveHarnesses(page, [claude], {
			runnable: true,
			harness: "claude-code",
			pinned: true,
			pinnedBy: "settings",
			blockedReason: null,
		});
		const patches: Record<string, unknown>[] = [];
		await serveHarnessSettings(
			page,
			{ harness: "claude-code", models: { "claude-code": "default" } },
			patches,
		);
		await page.goto("/settings?tab=agent");
		// The chip names the model the agent's default entry runs, never "Default".
		await expect(page.getByTestId("model-pill")).toHaveText("Fixture Opus");
		await page.getByTestId("agent-picker").click();
		const list = page.getByTestId("agent-picker-list");
		await expect(list.getByTestId("model-default")).toHaveCount(0);
		await expect(list).not.toContainText("Default");
		await expect(list.getByTestId("model-option")).toHaveCount(2);
		await expect(
			list.locator('[data-testid=model-option][data-model="Fixture Opus"]'),
		).toHaveAttribute("data-checked", "");
		// The star is the agent's model in Settings: one per agent.
		await list
			.locator('[data-testid=model-option][data-model="Fixture Sonnet"]')
			.getByTestId("model-star")
			.click();
		await expect
			.poll(() => patches.at(-1))
			.toEqual({ models: { "claude-code": "fixture-sonnet" } });
	});

	test("hide, star and reorder a model from the agent page", async ({
		page,
	}) => {
		await serveHarnesses(
			page,
			[{ ...OPENCODE_INSTALLED, modelVia: "acp" }, CLAUDE_INSTALLED],
			{
				runnable: true,
				harness: "opencode",
				pinned: false,
				pinnedBy: null,
				blockedReason: null,
			},
		);
		const patches: Record<string, unknown>[] = [];
		await serveHarnessSettings(page, { harness: "opencode" }, patches);
		await page.goto("/settings?tab=agent&agent=opencode");
		await expect(page.getByTestId("agent-detail-title")).toHaveText("OpenCode");
		const models = page.getByTestId("agent-models");
		await expect(page.getByTestId("agent-models-count")).toHaveText(
			"2 of 2 shown",
		);

		await models.getByLabel("Show Fixture Old in the picker").click();
		await expect
			.poll(() => patches.at(-1))
			.toEqual({
				hiddenModels: { opencode: ["vendor/fixture-old"] },
			});
		await models.getByLabel("Star Fixture Old").click();
		await expect
			.poll(() => patches.at(-1))
			.toEqual({ models: { opencode: "vendor/fixture-old" } });
		await expect(models).toContainText(
			"A run with no model picked uses the starred one, Fixture Old.",
		);
		await expect(models).not.toContainText("Default");
		await models.getByLabel("Move Fixture Old up").click();
		await expect
			.poll(() => patches.at(-1))
			.toEqual({
				modelOrder: {
					opencode: ["vendor/fixture-old", "vendor/fixture-current"],
				},
			});
		await expect(models.getByLabel("Move Fixture Old up")).toBeDisabled();

		// Hidden, the starred model still lists, first: a run with none picked uses it.
		await page.getByTestId("agent-detail-back").click();
		await page.getByTestId("agent-picker").click();
		const list = page.getByTestId("agent-picker-list");
		await list.getByTestId("rail-opencode").click();
		await expect(list.getByTestId("model-option")).toHaveCount(2);
		await expect(list.getByTestId("model-option").first()).toHaveAttribute(
			"data-model",
			"Fixture Old",
		);
		// Unstarred, the hidden model leaves the picker.
		await list.getByLabel("Unstar Fixture Old").click();
		await expect(list.getByTestId("model-option")).toHaveCount(1);
		await expect(list.getByTestId("model-option")).toHaveAttribute(
			"data-model",
			"Fixture Current",
		);
	});

	test("binary path refusal shows under the field", async ({ page }) => {
		await serveHarnesses(page, RUNNABLE, {
			runnable: true,
			harness: "opencode",
			pinned: false,
			pinnedBy: null,
			blockedReason: null,
		});
		await serveHarnessSettings(page, { harness: "opencode" });
		await page.route(isHarnessSettingsUrl, async (route) => {
			if (route.request().method() !== "PATCH") return route.fallback();
			await route.fulfill({
				status: 400,
				contentType: "application/json",
				body: JSON.stringify({
					defined: false,
					code: "BAD_REQUEST",
					status: 400,
					message: "No program at /nope/opencode.",
				}),
			});
		});
		await page.goto("/settings?tab=agent&agent=opencode");
		const input = page.getByTestId("runtime-binary-input");
		await input.fill("/nope/opencode");
		await input.press("Enter");
		await expect(page.getByTestId("runtime-binary-error")).toHaveText(
			"No program at /nope/opencode.",
		);
	});

	test("env variables read Not set, From environment or Key set; a value is never shown (#907)", async ({
		page,
	}) => {
		const opencode = (state: "unset" | "set"): HarnessFixture => ({
			...OPENCODE_INSTALLED,
			envVars: [
				{ name: "OPENAI_API_KEY", state: "env" },
				{ name: "OPENROUTER_API_KEY", state },
			],
		});
		const selection = {
			runnable: true,
			harness: "opencode",
			pinned: false,
			pinnedBy: null,
			blockedReason: null,
		};
		await serveHarnesses(
			page,
			[opencode("unset"), CLAUDE_INSTALLED],
			selection,
		);
		const patches: Record<string, unknown>[] = [];
		await serveHarnessSettings(page, { harness: "opencode" }, patches);
		await page.goto("/settings?tab=agent&agent=opencode");
		await expect(page.getByTestId("env-state-OPENAI_API_KEY")).toHaveText(
			"From environment",
		);
		await expect(page.getByTestId("env-state-OPENROUTER_API_KEY")).toHaveText(
			"Not set",
		);
		await page
			.getByTestId("env-row-OPENROUTER_API_KEY")
			.getByTestId("env-set")
			.click();
		await expect(page.getByTestId("env-name")).toHaveValue(
			"OPENROUTER_API_KEY",
		);
		await expect(page.getByTestId("env-value")).toHaveAttribute(
			"type",
			"password",
		);
		// The server answers the new state, never the value.
		await serveHarnesses(page, [opencode("set"), CLAUDE_INSTALLED], selection);
		await page.getByTestId("env-value").fill("sk-or-secret");
		await page.getByTestId("env-add-button").click();
		await expect
			.poll(() => patches.at(-1))
			.toEqual({
				env: { opencode: { OPENROUTER_API_KEY: "sk-or-secret" } },
			});
		await expect(page.getByTestId("env-state-OPENROUTER_API_KEY")).toHaveText(
			"Key set",
		);
		await expect(page.getByTestId("agent-environment")).not.toContainText(
			"sk-or-secret",
		);
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

		// A row carries one state word; the version and sign-in line are on the agent's page (#911).
		const registry = page.getByTestId("harness-registry");
		await expect(registry.getByTestId("harness-tested-opencode")).toHaveCount(
			0,
		);
		await expect(
			registry.getByTestId("harness-check-result-opencode"),
		).toBeVisible();
		await page.goto("/settings?tab=agent&agent=opencode");
		await expect(page.getByTestId("harness-tested-opencode")).toHaveText(
			"tested with 1.18.30",
		);
		// The hint renders its backticked spans as code, so match the text without them.
		await expect(
			page
				.getByTestId("agent-detail-capabilities")
				.locator("code", { hasText: "opencode auth login" }),
		).toBeVisible();
		await page.goto("/settings?tab=agent&agent=claude-code");
		await expect(page.getByTestId("agent-detail-title")).toHaveText(
			"Claude Code",
		);
		await expect(page.getByTestId("harness-tested-claude-code")).toHaveCount(0);
		await page.goto("/settings?tab=agent");

		// OpenCode takes a model: with nothing starred or reported, the chip names
		// its list's first, never a bare default (#673 w7, #907).
		await expect(page.getByTestId("model-pill")).toHaveText("Fixture Current");
		await page.getByTestId("agent-picker").click();
		const list = page.getByTestId("agent-picker-list");
		await expect(list.getByTestId("model-default")).toHaveCount(0);
		await expect(list.getByTestId("model-option")).toHaveCount(2);

		// Codex takes its model by its own settings until a check says otherwise:
		// a line asking for a check, no models.
		await list.getByTestId("rail-codex").click();
		await expect(list.getByTestId("model-pending")).toBeVisible();
		await expect(list.getByTestId("model-option")).toHaveCount(0);
	});

	test("a model starred for a harness that cannot take one is its only row, and unstarring clears it (#639, #907)", async ({
		page,
	}) => {
		await serveHarnesses(page, RUNNABLE, {
			runnable: false,
			harness: "codex",
			pinned: true,
			pinnedBy: "settings",
			blockedReason:
				"Codex picks its own model. Unstar vendor/stale in the picker above.",
		});
		await openHarnessSettings(page, {
			harness: "codex",
			models: { codex: "vendor/stale" },
		});

		await expect(page.getByTestId("harness-run-row")).toContainText(
			"Codex picks its own model",
		);
		// A model stored for an agent that cannot take one is its only row, starred;
		// unstarring it clears it.
		await page.getByTestId("agent-picker").click();
		const list = page.getByTestId("agent-picker-list");
		await expect(list.getByRole("option")).toHaveCount(1);
		await expect(list.getByTestId("model-option")).toContainText(
			"Codex picks its own model; unstar to clear",
		);
		await expect(list.getByTestId("model-default")).toHaveCount(0);
		await expect(list.getByTestId("model-star")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	test("works from the keyboard: Enter on a star clears a blocking model, picks a starred row, and stars a model (#781 review, #907)", async ({
		page,
	}) => {
		await serveHarnesses(page, RUNNABLE, {
			runnable: false,
			harness: "codex",
			pinned: true,
			pinnedBy: "settings",
			blockedReason:
				"Codex picks its own model. Unstar vendor/stale in the picker above.",
		});
		const patches: Record<string, unknown>[] = [];
		let current: Record<string, unknown> = {
			harness: "codex",
			// deepagents is not installed; its star must not be pickable.
			models: {
				codex: "vendor/stale",
				deepagents: "vendor/ghost",
				opencode: "vendor/fixture-current",
			},
		};
		await page.route(isHarnessSettingsUrl, async (route) => {
			if (route.request().method() === "PATCH") {
				const body = route.request().postDataJSON() as Record<string, unknown>;
				patches.push(body);
				current = {
					...current,
					...body,
					models: {
						...(current.models as Record<string, string | null>),
						...(body.models as Record<string, string | null> | undefined),
					},
				};
			}
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(current),
			});
		});
		await page.goto("/settings?tab=agent");
		await expect(
			page.getByRole("heading", { name: "Agent", exact: true }),
		).toBeVisible({ timeout: 15_000 });
		const picker = page.getByTestId("agent-picker");
		const list = page.getByTestId("agent-picker-list");

		// The blocking model's own row is starred; Enter on its star clears it.
		await picker.click();
		await expect(list.getByTestId("model-star")).toBeVisible({
			timeout: 15_000,
		});
		await list.getByTestId("model-star").focus();
		await page.keyboard.press("Enter");
		await expect.poll(() => patches.length).toBe(1);
		expect(patches[0]).toEqual({ models: { codex: null } });
		await page.keyboard.press("Escape");
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
		// One star per agent: starring another replaces it.
		expect(patches[2]).toEqual({ models: { opencode: "vendor/fixture-old" } });
	});

	test("shows the install hint for a harness that is not installed, under Add agent (#907)", async ({
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

		await page.getByTestId("harness-add-agent").first().click();
		await expect(
			page.getByTestId("add-agent-tile-deepagents-state"),
		).toHaveText("Not installed");
		await page.getByTestId("add-agent-tile-deepagents").click();
		await page.getByTestId("add-agent-next").click();
		await expect(page.getByTestId("add-agent-copy")).toContainText(
			"pip install deepagents-acp",
		);
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
			"Used by the next run",
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
			"Ready",
		);

		await page.getByTestId("harness-check-claude-code").click();
		await expect(
			page.getByTestId("harness-check-result-claude-code"),
		).toHaveText("Sign-in needed");
		await expect(page.getByTestId("harness-note-claude-code")).toHaveText(
			"Claude Code is not signed in to its model provider. Sign in with its own CLI, then retry.",
		);
	});

	test("shows Permission row under Next run with local defaults and agent notes (#673 w21)", async ({
		page,
	}) => {
		const CLAUDE_WITH_DEFAULTS: HarnessFixture = {
			...CLAUDE_INSTALLED,
			localDefault: {
				permission: {
					level: "auto",
					file: "~/.claude/settings.json",
					value: "auto",
				},
			},
		};
		await serveHarnesses(
			page,
			[
				OPENCODE_INSTALLED,
				CLAUDE_WITH_DEFAULTS,
				CODEX_INSTALLED,
				DEEPAGENTS_MISSING,
			],
			{
				runnable: true,
				harness: "claude-code",
				pinned: false,
				pinnedBy: null,
				blockedReason: null,
			},
		);
		await openHarnessSettings(page, { harness: "claude-code" });

		const accessRow = page.getByTestId("harness-access");
		await expect(accessRow).toBeVisible();
		await expect(accessRow).toContainText(
			'Auto, from ~/.claude/settings.json ("auto").',
		);

		const note = accessRow.getByTestId("harness-agent-note");
		await expect(note).toBeVisible();
		await expect(note).toContainText(
			"Your ~/.claude/settings.json allow and deny rules, hooks and sandbox apply",
		);
	});

	test("updates Permission via PATCH /settings/harness; every option is a level's own name (#673 w21, #907)", async ({
		page,
	}) => {
		await serveHarnesses(page, RUNNABLE, {
			runnable: true,
			harness: "claude-code",
			pinned: false,
			pinnedBy: null,
			blockedReason: null,
		});

		const patches: Record<string, unknown>[] = [];
		let current: {
			harness: string;
			accessLevels?: Record<string, string | null>;
		} = {
			harness: "claude-code",
		};

		await page.route(isHarnessSettingsUrl, async (route) => {
			if (route.request().method() === "PATCH") {
				const body = route.request().postDataJSON() as Record<string, unknown>;
				patches.push(body);
				current = {
					...current,
					...body,
					...(body.accessLevels
						? {
								accessLevels: {
									...current.accessLevels,
									...(body.accessLevels as Record<string, string | null>),
								},
							}
						: {}),
				};
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

		await page.goto("/settings?tab=agent");
		await expect(
			page.getByRole("heading", { name: "Agent", exact: true }),
		).toBeVisible({ timeout: 15_000 });

		// Unset, the select names the level a run takes, never "Default".
		await expect(page.getByTestId("harness-access-select")).toHaveText(
			"Ask always",
		);
		// Pick Auto-accept edits in Permission select
		await page.getByTestId("harness-access-select").click();
		await page
			.getByRole("option", { name: "Auto-accept edits", exact: true })
			.click();
		await expect.poll(() => patches.length).toBe(1);
		expect(patches[0]).toEqual({
			accessLevels: { "claude-code": "auto-edits" },
		});
		await expect(page.getByTestId("harness-access")).toContainText(
			"Auto-accept edits, set here.",
		);

		await page.getByTestId("harness-access-select").click();
		await expect(page.getByRole("option")).toHaveCount(4);
		await expect(
			page.getByRole("option", { name: "Default", exact: true }),
		).toHaveCount(0);
		await page.keyboard.press("Escape");
	});

	test("Permission row states the alert-run rule under Settings > Agent (#818)", async ({
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

		const alertRuns = page.getByTestId("harness-alert-runs");
		await expect(alertRuns).toBeVisible();
		await expect(alertRuns).toHaveText(
			"Runs an alert starts don't use this: nobody is there to answer, so they run at Auto and refuse anything they would ask you.",
		);
	});

	test("renders description line variants for Permission across harnesses (#673 w21)", async ({
		page,
	}) => {
		const CODEX_UNCHECKED: HarnessFixture = {
			...CODEX_INSTALLED,
			checked: {
				at: "2026-10-10T00:00:00Z",
				outcome: "answers-acp",
				detail: "answers ACP",
				servedModel: null,
				effort: null,
				modes: [{ id: "read-only", name: "Ask for approval" }],
				efforts: null,
				images: false,
				sandbox: null,
			},
		};
		const GEMINI_AUTO_EDIT: HarnessFixture = {
			id: "gemini",
			label: "Gemini CLI",
			binary: "gemini",
			installed: true,
			install: "npm i -g @google/gemini-cli",
			defaultModel: null,
			tested: null,
			modelVia: "unsupported",
			loginHint: "`gemini login`",
			localDefault: {
				permission: {
					level: "auto-edits",
					file: "~/.gemini/settings.json",
					value: "auto_edit",
				},
			},
			models: NO_MODELS,
		};

		let currentHarness = "opencode";
		await page.route(isHarnessesUrl, async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					harnesses: [
						OPENCODE_INSTALLED,
						CLAUDE_INSTALLED,
						CODEX_UNCHECKED,
						GEMINI_AUTO_EDIT,
						DEEPAGENTS_MISSING,
					],
					selection: {
						runnable: true,
						harness: currentHarness,
						pinned: false,
						pinnedBy: null,
						blockedReason: null,
					},
				}),
			});
		});
		await page.route(isHarnessSettingsUrl, async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ harness: currentHarness }),
			});
		});

		// 1. OpenCode
		await page.goto("/settings?tab=agent");
		await expect(
			page.getByRole("heading", { name: "Agent", exact: true }),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("harness-access")).toContainText(
			"Ask always, PrismaLens's pick. OpenCode has per-tool rules, not one permission level.",
		);
		await expect(page.getByTestId("harness-agent-note")).toContainText(
			"Your opencode.json rules stay; PrismaLens sets each tool's catch-all for the level.",
		);

		// 2. Codex without workspace-write in checked modes
		currentHarness = "codex";
		await page.reload();
		await expect(page.getByTestId("harness-agent-note")).toContainText(
			"This codex-acp runs Ask always and Auto-accept edits in the same mode, Ask for approval; edits inside the copy need no ask.",
		);

		// 3. Gemini: its own auto_edit maps to Auto-accept edits (#907)
		currentHarness = "gemini";
		await page.reload();
		await expect(page.getByTestId("harness-access")).toContainText(
			'Auto-accept edits, from ~/.gemini/settings.json ("auto_edit").',
		);
		await expect(page.getByTestId("harness-agent-note")).toContainText(
			"Gemini CLI's own folder trust and settings apply, as in your terminal.",
		);

		// 4. deepagents
		currentHarness = "deepagents";
		await page.reload();
		await expect(page.getByTestId("harness-access")).toContainText(
			"Ask always, PrismaLens's pick. deepagents has no modes.",
		);
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
			await page.goto("/settings?tab=agent");
			await expect(page.locator("html")).toHaveClass(new RegExp(theme));
			await expect(card(page)).toBeVisible({ timeout: 15_000 });
			await page.unroute(isHarnessesUrl);
		};

		await renderCard("light", RUNNABLE);
		await renderCard("dark", RUNNABLE);
		await renderCard("light", NOTHING);
		await renderCard("light", "error");
	});

	test("agent page and Add agent dialog, light and dark (#907)", async ({
		page,
		baseURL,
	}, testInfo) => {
		test.setTimeout(90_000);
		await serveHarnessSettings(page, {
			harness: "opencode",
			envNames: { opencode: ["OPENROUTER_API_KEY"] },
		});
		const opencode: HarnessFixture = {
			...OPENCODE_INSTALLED,
			envVars: [
				{ name: "ANTHROPIC_API_KEY", state: "unset" },
				{ name: "OPENAI_API_KEY", state: "env" },
				{ name: "OPENROUTER_API_KEY", state: "set" },
			],
		};
		await serveHarnesses(page, [opencode, ...RUNNABLE.slice(1)], {
			runnable: true,
			harness: "opencode",
			pinned: false,
			pinnedBy: null,
			blockedReason: null,
		});
		for (const theme of ["light", "dark"] as const) {
			await page
				.context()
				.addCookies([
					{ name: "prismalens-theme", value: theme, url: baseURL as string },
				]);
			await page.goto("/settings?tab=agent&agent=opencode");
			await expect(page.locator("html")).toHaveClass(new RegExp(theme));
			await expect(page.getByTestId("agent-detail")).toBeVisible({
				timeout: 15_000,
			});
			await page.screenshot({
				path: testInfo.outputPath(`agent-page-${theme}.png`),
				fullPage: true,
				animations: "disabled",
			});
			await page.goto("/settings?tab=agent");
			await page.getByTestId("harness-add-agent").first().click();
			await expect(page.getByTestId("add-agent-dialog")).toBeVisible();
			await page.screenshot({
				path: testInfo.outputPath(`add-agent-${theme}.png`),
				animations: "disabled",
			});
		}
	});
});
