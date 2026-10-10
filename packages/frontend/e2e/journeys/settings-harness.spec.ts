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

type SettingsFixture = {
	harness: string;
	models?: Record<string, string | null>;
	efforts?: Record<string, string | null>;
	accessLevels?: Record<string, string | null>;
	autoAccessLevels?: Record<string, string | null>;
	favourites?: { harness: string; model: string }[];
};

/** The persisted harness choice `GET /settings/harness` answers with. */
async function serveHarnessSettings(
	page: Page,
	settings: SettingsFixture,
): Promise<void> {
	let current = { ...settings };
	await page.route(isHarnessSettingsUrl, async (route) => {
		if (route.request().method() === "PATCH") {
			const body = (route.request().postDataJSON() || {}) as Record<
				string,
				unknown
			>;
			current = {
				...current,
				...body,
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
				autoAccessLevels: {
					...current.autoAccessLevels,
					...(body.autoAccessLevels as
						| Record<string, string | null>
						| undefined),
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
			"tested 1.18.30",
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
			"answers ACP",
		);

		await page.getByTestId("harness-check-claude-code").click();
		await expect(
			page.getByTestId("harness-check-result-claude-code"),
		).toHaveText("sign in needed (Log in with Claude)");
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
			'Your default: Auto, from ~/.claude/settings.json ("auto").',
		);

		const note = accessRow.getByTestId("harness-agent-note");
		await expect(note).toBeVisible();
		await expect(note).toContainText(
			"Your ~/.claude/settings.json allow and deny rules, hooks and sandbox apply",
		);
	});

	test("updates Permission via PATCH /settings/harness and clears with Default (#673 w21)", async ({
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

		await page.goto("/settings?tab=harness");
		await expect(
			page.getByRole("heading", { name: "Agent", exact: true }),
		).toBeVisible({ timeout: 15_000 });

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

		// Reset Permission with Default
		await page.getByTestId("harness-access-select").click();
		await page.getByRole("option", { name: "Default", exact: true }).click();
		await expect.poll(() => patches.length).toBe(2);
		expect(patches[1]).toEqual({ accessLevels: { "claude-code": null } });
	});

	test("shows Auto-started runs row, inherits Next run when unset, and saves overrides (#673 w21)", async ({
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

		const patches: Record<string, unknown>[] = [];
		let current: {
			harness: string;
			autoAccessLevels?: Record<string, string | null>;
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
					...(body.autoAccessLevels
						? {
								autoAccessLevels: {
									...current.autoAccessLevels,
									...(body.autoAccessLevels as Record<string, string | null>),
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

		await page.goto("/settings?tab=harness");
		await expect(
			page.getByRole("heading", { name: "Agent", exact: true }),
		).toBeVisible({ timeout: 15_000 });

		const autoGroup = page.getByTestId("harness-auto-start");
		await expect(autoGroup).toBeVisible();
		await expect(autoGroup).toContainText(
			"Runs PrismaLens starts from an alert",
		);

		// Unset line inherits Next run
		const autoAccessRow = page.getByTestId("harness-auto-access");
		await expect(autoAccessRow).toContainText("Same as next run: Auto.");

		// Override Auto Permission to Auto-accept edits
		await page.getByTestId("harness-auto-access-select").click();
		await page
			.getByRole("option", { name: "Auto-accept edits", exact: true })
			.click();
		await expect.poll(() => patches.length).toBe(1);
		expect(patches[0]).toEqual({
			autoAccessLevels: { "claude-code": "auto-edits" },
		});
		await expect(autoAccessRow).toContainText("Auto-accept edits, set here.");

		// Clear Auto Permission with Same as next run
		await page.getByTestId("harness-auto-access-select").click();
		await page
			.getByRole("option", { name: "Same as next run", exact: true })
			.click();
		await expect.poll(() => patches.length).toBe(2);
		expect(patches[1]).toEqual({ autoAccessLevels: { "claude-code": null } });
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
		const GEMINI_UNTRUSTED: HarnessFixture = {
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
					level: null,
					file: "~/.gemini/settings.json",
					value: "auto_edit",
					reason: "Gemini CLI runs the copy untrusted here",
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
						GEMINI_UNTRUSTED,
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
		await page.goto("/settings?tab=harness");
		await expect(
			page.getByRole("heading", { name: "Agent", exact: true }),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("harness-access")).toContainText(
			"Ask always, PrismaLens default. OpenCode has per-tool rules, not one permission level.",
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

		// 3. Gemini with untrusted reason
		currentHarness = "gemini";
		await page.reload();
		await expect(page.getByTestId("harness-access")).toContainText(
			'Ask always, PrismaLens default. Gemini CLI runs the copy untrusted here, so "auto_edit" cannot apply.',
		);
		await expect(page.getByTestId("harness-agent-note")).toContainText(
			"Gemini CLI runs the copy untrusted, so every level runs as Ask always here.",
		);

		// 4. deepagents
		currentHarness = "deepagents";
		await page.reload();
		await expect(page.getByTestId("harness-access")).toContainText(
			"Ask always, PrismaLens default. deepagents has no modes.",
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
