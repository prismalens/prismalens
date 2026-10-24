// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

/**
 * Add agent (#907): every supported agent with a neutral state word, a sign-in
 * step that shows the agent's own command, and a local ACP command. Served from
 * fixtures, with the PATCH bodies captured, so CI and a laptop assert the same.
 */

type Status = Record<string, unknown> & { id: string; runnable: boolean };

const base = {
	tested: null,
	defaultModel: null,
	localDefault: { permission: null },
	modelVia: "acp",
	envModel: null,
	windowsOnlyPath: null,
	configDir: null,
	providerKeys: [],
	envVars: [],
	models: { source: "catalogue", asOf: "2026-10-23T00:00:00Z", entries: [] },
	checked: null,
};

const signedOut = {
	at: "2026-10-23T00:00:00Z",
	outcome: "sign-in-needed",
	detail: "sign in needed (API Key, ChatGPT)",
	servedModel: null,
	effort: null,
	images: false,
};

function fixtures(): Status[] {
	return [
		{
			...base,
			id: "claude-code",
			label: "Claude Code",
			binary: "claude-agent-acp",
			cliBinary: "claude",
			installed: true,
			runnable: true,
			install: "npm i -g @anthropic-ai/claude-code",
			loginHint: "`claude /login`, or `ANTHROPIC_API_KEY` in env",
		},
		{
			...base,
			id: "codex",
			label: "Codex",
			binary: "codex-acp",
			cliBinary: "codex",
			installed: true,
			runnable: false,
			install: "npm i -g @openai/codex",
			loginHint: "`codex login`, or `OPENAI_API_KEY` in env",
			configDir: { envKey: "CODEX_HOME", shownDefault: "~/.codex" },
			checked: signedOut,
		},
		{
			...base,
			id: "local",
			label: "Local agent",
			binary: "",
			cliBinary: "",
			installed: false,
			runnable: false,
			install: "Add it under Settings → Agent → Add agent → Local ACP command.",
			loginHint: "It signs in on its own.",
		},
	];
}

async function serve(page: Page) {
	const harnesses = fixtures();
	const patches: Record<string, unknown>[] = [];
	let settings: Record<string, unknown> = { harness: "auto" };
	await page.route(
		(url) => url.pathname === "/api/settings/harnesses",
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					harnesses,
					selection: {
						runnable: true,
						harness: "claude-code",
						pinned: false,
						pinnedBy: null,
						blockedReason: null,
					},
				}),
			}),
	);
	await page.route(
		(url) => url.pathname === "/api/settings/harness",
		async (route) => {
			if (route.request().method() === "PATCH") {
				const body = route.request().postDataJSON() as Record<string, unknown>;
				patches.push(body);
				const { env: _, ...rest } = body;
				settings = { ...settings, ...rest };
			}
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(settings),
			});
		},
	);
	await page.route(
		(url) => url.pathname === "/api/settings/harness/check",
		async (route) => {
			const { id } = route.request().postDataJSON() as { id: string };
			const row = harnesses.find((h) => h.id === id);
			// The check answers once the user has signed in on the host.
			if (row) {
				row.runnable = true;
				row.checked = {
					...signedOut,
					outcome: "answers-acp",
					detail: "answers ACP",
				};
			}
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					id,
					outcome: "answers-acp",
					detail: "answers ACP",
					hard: false,
				}),
			});
		},
	);
	return { patches };
}

async function openAddAgent(page: Page) {
	await page.goto("/settings?tab=harness");
	await expect(page.getByTestId("harness-settings")).toBeVisible({
		timeout: 15_000,
	});
	await page.getByTestId("harness-add-agent").first().click();
	await expect(page.getByTestId("add-agent-dialog")).toBeVisible();
}

test.describe("Add agent (#907)", () => {
	test("Add agent: Codex signed out shows its sign-in command; Check and add lists it once the check answers", async ({
		page,
	}) => {
		await serve(page);
		await openAddAgent(page);
		const registry = page.getByTestId("harness-registry");
		await expect(registry.getByTestId("harness-row-codex")).toHaveCount(0);

		await expect(
			page.getByTestId("add-agent-tile-claude-code-state"),
		).toHaveText("Ready");
		await expect(page.getByTestId("add-agent-tile-codex-state")).toHaveText(
			"Sign-in needed",
		);
		await page.getByTestId("add-agent-tile-codex").click();
		await page.getByTestId("add-agent-next").click();
		const signIn = page.getByTestId("add-agent-signin");
		await expect(
			signIn.locator("code", { hasText: "codex login" }),
		).toBeVisible();
		await expect(signIn.getByTestId("add-agent-copy")).toBeVisible();
		await expect(signIn.getByTestId("add-agent-api-key")).toContainText(
			"OPENAI_API_KEY",
		);

		await page.getByTestId("add-agent-next").click();
		await expect(page.getByTestId("add-agent-config")).toBeVisible();
		await page.getByTestId("add-agent-check-and-add").click();
		await expect(page.getByTestId("add-agent-dialog")).toHaveCount(0);
		await expect(registry.getByTestId("harness-row-codex")).toBeVisible();
	});

	test("Add agent: Local ACP command parses arguments and saves localAgent", async ({
		page,
	}) => {
		const { patches } = await serve(page);
		await openAddAgent(page);
		await page.getByTestId("add-agent-tile-local").click();
		await page.getByTestId("add-agent-command").fill("/usr/bin/node");
		await page.getByTestId("add-agent-args").fill("agent.mjs | tee log");
		await page.getByTestId("add-agent-next").click();
		await expect(page.getByTestId("add-agent-error")).toHaveText(
			"Arguments can't hold shell operators.",
		);
		expect(patches).toEqual([]);

		await page
			.getByTestId("add-agent-args")
			.fill('agent.mjs --name "my agent"');
		await page.getByTestId("add-agent-next").click();
		await expect
			.poll(() => patches.at(-1))
			.toEqual({
				localAgent: {
					command: "/usr/bin/node",
					args: ["agent.mjs", "--name", "my agent"],
				},
			});
		await expect(page.getByTestId("add-agent-signin")).toBeVisible();
	});

	test("the picker's rail opens Add agent too", async ({ page }) => {
		await serve(page);
		await page.goto("/settings?tab=harness");
		await page.getByTestId("agent-picker").click();
		await page.getByTestId("rail-add-agent").click();
		await expect(page.getByTestId("add-agent-dialog")).toBeVisible();
		await expect(page.getByTestId("add-agent-tile-codex")).toBeVisible();
	});
});

test.describe("Add agent on the real stack (#907)", () => {
	test("a Local ACP command running the fake agent joins the list after its check", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const fake = fileURLToPath(
			new URL("../../../../scripts/fakes/fake-acp-agent.mjs", import.meta.url),
		);
		try {
			await page.goto("/settings?tab=harness");
			await expect(page.getByTestId("harness-settings")).toBeVisible({
				timeout: 15_000,
			});
			await page.getByTestId("harness-add-agent").first().click();
			await page.getByTestId("add-agent-tile-local").click();
			await page.getByTestId("add-agent-command").fill(process.execPath);
			await page
				.getByTestId("add-agent-args")
				.fill(`${JSON.stringify(fake)} --session success`);
			await page.getByTestId("add-agent-next").click();
			await expect(page.getByTestId("add-agent-signin")).toBeVisible();
			await page.getByTestId("add-agent-next").click();
			await page.getByTestId("add-agent-check-and-add").click();
			await expect(page.getByTestId("add-agent-dialog")).toHaveCount(0, {
				timeout: 30_000,
			});
			await expect(
				page.getByTestId("harness-registry").getByTestId("harness-row-local"),
			).toBeVisible();
		} finally {
			await page.request.patch("/api/settings/harness", {
				data: { localAgent: null },
			});
		}
	});
});
