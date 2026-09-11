// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";

/**
 * Investigation-agent surface (#501, ADR-0031; narrowed by #337/#609).
 *
 * The AI-provider card, its per-provider credential UI, and the raw-report
 * banner are gone — there is no LLM router any more. What is left is
 * `GET /settings/harnesses` (ADR 0003 §9): a registry row per harness
 * (installed/verified on this machine) plus the gate's own selection
 * verdict, rendered verbatim. The picker below it is LIVE: it reads and
 * writes `GET`/`PATCH /settings/harness`, the persisted choice and model —
 * `PRISMALENS_HARNESS`, when set, still wins at investigation time
 * (`selection.pinned`), which the card says plainly rather than disabling
 * the picker.
 *
 * Every verdict here is served from a fixture rather than the machine running
 * the suite, so a CI box and a developer laptop assert the same thing.
 */

const SHOTS = "e2e/journeys/screenshots";

type HarnessFixture = {
	id: string;
	label: string;
	binary: string;
	installed: boolean;
	verified: boolean;
	install: string;
};

const CLAUDE_INSTALLED: HarnessFixture = {
	id: "claude-code",
	label: "Claude Code",
	binary: "claude-agent-acp",
	installed: true,
	verified: false,
	install: "npm i -g @agentclientprotocol/claude-agent-acp  (needs `claude login`)",
};

const OPENCODE_INSTALLED: HarnessFixture = {
	id: "opencode",
	label: "OpenCode",
	binary: "opencode",
	installed: true,
	verified: true,
	install: "curl -fsSL https://opencode.ai/install | bash  (or: npm i -g opencode-ai)",
};

const DEEPAGENTS_MISSING: HarnessFixture = {
	id: "deepagents",
	label: "deepagents",
	binary: "deepagents-acp",
	installed: false,
	verified: false,
	install: "pip install deepagents-acp",
};

/** A machine with opencode (verified, on PATH) and nothing else. */
const RUNNABLE: HarnessFixture[] = [
	OPENCODE_INSTALLED,
	CLAUDE_INSTALLED,
	DEEPAGENTS_MISSING,
];

/** The falsifier machine: no harness binary anywhere. */
const NOTHING: HarnessFixture[] = [
	{ ...OPENCODE_INSTALLED, installed: false },
	{ ...CLAUDE_INSTALLED, installed: false },
	DEEPAGENTS_MISSING,
];

const NO_HARNESS_REASON =
	"No coding agent found on PATH. Install one: OpenCode: curl -fsSL https://opencode.ai/install | bash  (or: npm i -g opencode-ai); Claude Code: npm i -g @agentclientprotocol/claude-agent-acp  (needs `claude login`); Codex: npm i -g @agentclientprotocol/codex-acp  (needs `codex login` or OPENAI_API_KEY); Gemini CLI: npm i -g @google/gemini-cli; deepagents: pip install deepagents-acp.";

const isHarnessesUrl = (url: URL) => url.pathname === "/api/settings/harnesses";

async function serveHarnesses(
	page: Page,
	harnesses: HarnessFixture[],
	selection: {
		runnable: boolean;
		harness: string | null;
		pinned: boolean;
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
			body: JSON.stringify({ message: "harness status unavailable" }),
		});
	});
}

const isHarnessSettingsUrl = (url: URL) => url.pathname === "/api/settings/harness";

/** The persisted harness choice `GET /settings/harness` answers with. */
async function serveHarnessSettings(
	page: Page,
	settings: { harness: string; model?: string },
): Promise<void> {
	await page.route(isHarnessSettingsUrl, async (route) => {
		if (route.request().method() !== "GET") {
			await route.fallback();
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(settings),
		});
	});
}

async function openHarnessSettings(
	page: Page,
	settings: { harness: string; model?: string } = { harness: "auto" },
): Promise<void> {
	await serveHarnessSettings(page, settings);
	await page.goto("/settings?tab=harness");
	await expect(
		page.getByRole("heading", { name: "Investigation agent", exact: true }),
	).toBeVisible({ timeout: 15_000 });
}

const card = (page: Page) => page.getByTestId("harness-settings");

test.describe("Investigation agent settings card (#501/#609)", () => {
	test("lists every registry harness with its installed/verified badges", async ({
		page,
	}) => {
		await serveHarnesses(page, RUNNABLE, {
			runnable: true,
			harness: "opencode",
			pinned: false,
			blockedReason: null,
		});
		await openHarnessSettings(page);

		const registry = page.getByTestId("harness-registry");
		await expect(registry.getByText("OpenCode", { exact: true })).toBeVisible();
		await expect(
			registry.getByText("Claude Code", { exact: true }),
		).toBeVisible();
		await expect(registry.getByText("deepagents", { exact: true })).toBeVisible();
		await expect(registry.getByText("Installed", { exact: true })).toHaveCount(2);
		await expect(
			registry.getByText("Not installed", { exact: true }),
		).toHaveCount(1);
		await expect(registry.getByText("Verified", { exact: true })).toHaveCount(1);
		await expect(registry.getByText("Unverified", { exact: true })).toHaveCount(2);
	});

	test("shows the install hint for a harness that is not installed", async ({
		page,
	}) => {
		await serveHarnesses(page, NOTHING, {
			runnable: false,
			harness: null,
			pinned: false,
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
			blockedReason: null,
		});
		await openHarnessSettings(page);

		const verdict = page.getByTestId("harness-selection");
		await expect(verdict).toContainText("An investigation would start with opencode");
		await expect(page.getByTestId("harness-pinned-notice")).toHaveCount(0);
	});

	test("shows a notice that PRISMALENS_HARNESS overrides the picker when pinned", async ({
		page,
	}) => {
		await serveHarnesses(page, RUNNABLE, {
			runnable: true,
			harness: "claude-code",
			pinned: true,
			blockedReason: null,
		});
		await openHarnessSettings(page);

		const verdict = page.getByTestId("harness-selection");
		await expect(verdict).toContainText(
			"An investigation would start with claude-code",
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
			blockedReason: NO_HARNESS_REASON,
		});
		await openHarnessSettings(page);

		const banner = page.getByTestId("harness-none-available");
		await expect(banner).toBeVisible();

		const verdict = page.getByTestId("harness-selection");
		await expect(verdict).toContainText(
			"An investigation would not start right now",
		);
		await expect(verdict).toContainText(NO_HARNESS_REASON);
	});

	test("keeps the card usable when the status endpoint fails", async ({
		page,
	}) => {
		await failHarnesses(page);
		await openHarnessSettings(page);

		await expect(page.getByTestId("harness-status-error")).toBeVisible();
	});

	test("saves the picked harness and model through PATCH /settings/harness", async ({
		page,
	}) => {
		await serveHarnesses(page, RUNNABLE, {
			runnable: true,
			harness: "opencode",
			pinned: false,
			blockedReason: null,
		});
		await openHarnessSettings(page, { harness: "auto" });

		// Stateful: the "Saved" line reads back through a GET the update hook
		// re-fires on success, so the fixture has to actually remember the write —
		// a GET that always answers with the pre-save value would leave the
		// picker "dirty" forever and the confirmation text would never appear.
		let savedBody: Record<string, unknown> | undefined;
		let current: { harness: string; model?: string } = { harness: "auto" };
		await page.route(isHarnessSettingsUrl, async (route) => {
			if (route.request().method() === "PATCH") {
				savedBody = route.request().postDataJSON();
				current = { harness: "opencode", model: "sonnet-4" };
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

		const saveButton = page.getByRole("button", { name: "Save agent" });
		await expect(saveButton).toBeDisabled();

		await page.locator("#harness-picker").click();
		await page.getByRole("option", { name: "OpenCode" }).click();
		await page.getByLabel("Model").fill("sonnet-4");
		await expect(saveButton).toBeEnabled();
		await saveButton.click();

		await expect.poll(() => savedBody).toBeTruthy();
		expect(savedBody).toMatchObject({ harness: "opencode", model: "sonnet-4" });
		await expect(
			card(page).getByText(/Saved — investigations use OpenCode \(sonnet-4\)/),
		).toBeVisible();
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
					blockedReason: harnesses === RUNNABLE ? null : NO_HARNESS_REASON,
				});
			}
			await page.goto("/settings?tab=harness");
			await expect(page.locator("html")).toHaveClass(new RegExp(theme));
			await expect(card(page)).toBeVisible({ timeout: 15_000 });
			await page.waitForLoadState("networkidle");
			await card(page).screenshot({ path: `${SHOTS}/${name}.png` });
			await page.unroute(isHarnessesUrl);
		};

		await shot("settings-harness-default", "light", RUNNABLE);
		await shot("settings-harness-dark", "dark", RUNNABLE);
		await shot("settings-harness-empty", "light", NOTHING);
		await shot("settings-harness-error", "light", "error");
	});
});
