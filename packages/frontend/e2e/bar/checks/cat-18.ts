// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { defineChecks, verdict } from "../bar";

const SETTINGS_PAGES = [
	{ tab: "general", label: "General" },
	{ tab: "models", label: "Models" },
	{ tab: "permissions", label: "Permissions" },
	{ tab: "organizer", label: "Agent-started threads" },
	{ tab: "agent", label: "Agents" },
	{ tab: "appearance", label: "Appearance" },
	{ tab: "notifications", label: "Notifications" },
	{ tab: "shortcuts", label: "Keyboard shortcuts" },
	{ tab: "usage", label: "Usage" },
	{ tab: "runs", label: "Runs" },
	{ tab: "alert-intake", label: "Alert intake" },
	{ tab: "sources", label: "Sources" },
	{ tab: "devices", label: "Devices" },
	{ tab: "telemetry", label: "Usage data" },
	{ tab: "about", label: "About" },
] as const;

/** #1101 category 18, Settings. */
export default defineChecks([
	{
		item: "18.1",
		async run({ page, open }) {
			const fails: string[] = [];
			await open("/settings");

			// 1. Search across Settings
			const search = page.getByTestId("settings-search");
			await expect(search).toBeVisible();
			await search.fill("agent");

			const results = page.getByTestId("settings-results");
			await expect(results).toBeVisible();
			const resultRows = page.getByTestId("settings-result");
			const foundCount = await resultRows.count();
			if (foundCount === 0) {
				fails.push("settings search for 'agent' returned no rows");
			} else {
				const rowTexts = await resultRows.allInnerTexts();
				const bare = rowTexts.filter(
					(t) => t.split("\n").filter((l) => l.trim()).length < 3,
				);
				if (bare.length > 0) {
					fails.push(
						`${bare.length} search rows lack name / sentence / page, e.g. "${bare[0]}"`,
					);
				}
			}

			// Clear search to view standard settings page
			await search.fill("");

			// 2. Setting rows have a name and a control
			await open("/settings?tab=general");
			const rows = page.locator(
				'[data-testid^="general-"][data-testid$="-row"]',
			);
			await expect(rows.first()).toBeVisible();
			const rowCount = await rows.count();
			let bareRows = 0;
			for (let i = 0; i < rowCount; i++) {
				const row = rows.nth(i);
				const name = ((await row.innerText()).split("\n")[0] ?? "").trim();
				const controls = await row
					.locator('button, input, [role="switch"], [role="combobox"]')
					.count();
				if (!name || controls === 0) bareRows++;
			}
			if (rowCount < 3 || bareRows > 0) {
				fails.push(
					`General page has ${rowCount} rows, ${bareRows} without a name or a control`,
				);
			}

			// 3. A changed row shows Reset, and Reset restores the default
			await open("/settings?tab=permissions");
			const select = page.getByTestId("permissions-agent-codex-select");
			await expect(select).toBeVisible();
			const original = (await select.innerText()).trim();
			const agentRow = page.getByTestId("permissions-agent-codex");
			const reset = agentRow.getByRole("button", { name: "Reset" });
			await expect(reset).toHaveCount(0);
			await select.click();
			const choices = await page.getByRole("option").allInnerTexts();
			const other = choices.map((c) => c.trim()).find((c) => c !== original);
			if (!other)
				throw new Error(`permission select offers only "${original}"`);
			await page.getByRole("option", { name: other, exact: true }).click();
			try {
				await expect(reset).toBeVisible({ timeout: 10_000 });
				await reset.click();
				await expect(select).toHaveText(original, { timeout: 10_000 });
				await expect(reset).toHaveCount(0);
			} finally {
				if ((await select.innerText()).trim() !== original) {
					await select.click();
					await page
						.getByRole("option", { name: original, exact: true })
						.click();
				}
			}

			return verdict(
				fails,
				`search across settings returned ${foundCount} items; all search rows read name, sentence and page; ${rowCount} General rows each have a name and a control; Codex permission "${original}" -> "${other}" showed Reset, which restored "${original}"`,
			);
		},
	},
	{
		item: "18.3",
		async run({ page, open }) {
			const fails: string[] = [];

			// 1. Check folded advanced options in Models
			await open("/settings?tab=models");
			const modelsAdvanced = page.getByTestId("models-advanced");
			await expect(modelsAdvanced).toBeVisible();

			const isOpenModels = await modelsAdvanced.evaluate(
				(el) => (el as HTMLDetailsElement).open,
			);
			if (isOpenModels) {
				fails.push("Models advanced fold is open by default");
			}
			const summaryModels = await modelsAdvanced.locator("summary").innerText();
			if (!summaryModels.includes("Advanced")) {
				fails.push(
					`Models summary does not read 'Advanced': "${summaryModels}"`,
				);
			}

			// 2. Check folded advanced options in Agents
			await open("/settings?tab=agent");
			const agentAdvanced = page.getByTestId("harness-long-advanced");
			await expect(agentAdvanced).toBeVisible();

			const isOpenAgent = await agentAdvanced.evaluate(
				(el) => (el as HTMLDetailsElement).open,
			);
			if (isOpenAgent) {
				fails.push("Agent advanced fold is open by default");
			}

			return verdict(
				fails,
				"advanced options in Models and Agents are folded inside details disclosure elements with summary 'Advanced'",
			);
		},
	},
	{
		item: "18.4",
		async run({ page, open }) {
			const fails: string[] = [];
			await open("/settings?tab=permissions");

			const riskNotice = page.getByTestId("harness-unattended-github-risk");
			await expect(riskNotice).toBeVisible();
			const noticeText = await riskNotice.innerText();
			if (!noticeText.toLowerCase().includes("risk")) {
				fails.push(`row does not state risk: "${noticeText}"`);
			}

			// Toggling dangerous setting opens confirmation dialog
			const switchControl = page.getByTestId("harness-unattended-github");
			await switchControl.click();

			const confirmDialog = page.getByTestId(
				"harness-unattended-github-confirm",
			);
			await expect(confirmDialog).toBeVisible();

			const desc = await confirmDialog.innerText();
			if (
				!desc.toLowerCase().includes("push") &&
				!desc.toLowerCase().includes("nobody watching")
			) {
				fails.push(`confirmation dialog does not explain risk: "${desc}"`);
			}

			// Cancelling leaves it off
			const cancelBtn = page.getByTestId(
				"harness-unattended-github-confirm-cancel",
			);
			await cancelBtn.click();
			await expect(confirmDialog).not.toBeVisible();

			const checked = await switchControl.getAttribute("aria-checked");
			if (checked === "true") {
				fails.push("dangerous setting turned on despite cancel");
			}

			return verdict(
				fails,
				`dangerous choice states risk at row ("${noticeText}") and requires second confirmation dialog before saving`,
			);
		},
	},
	{
		item: "18.5",
		async run({ page, open }) {
			const fails: string[] = [];

			// 1. Read default agent/model from Settings -> Models
			await open("/settings?tab=models");
			const modelRow = page.getByTestId("harness-run-row");
			await expect(modelRow).toBeVisible();
			const settingsPicker = modelRow.getByTestId("agent-picker");
			await expect(settingsPicker).toBeVisible();
			await expect(settingsPicker).toHaveText(/[A-Za-z]{3,}/, {
				timeout: 15_000,
			});
			const expectedPickerText = (await settingsPicker.innerText()).trim();
			const settingsEffort = (
				await page
					.getByTestId("harness-effort")
					.getByTestId("effort-chip")
					.innerText()
			).trim();
			await open("/settings?tab=permissions");
			const perAgent = await Promise.all(
				["opencode", "claude-code", "codex"].map(async (id) =>
					(
						await page.getByTestId(`permissions-agent-${id}-select`).innerText()
					).trim(),
				),
			);

			// 2. Open /new and verify composer pickers match
			await open("/new");
			const composerPicker = page.getByTestId("agent-picker");
			await expect(composerPicker).toBeVisible();
			await expect(composerPicker).toHaveText(/[A-Za-z]{3,}/, {
				timeout: 15_000,
			});
			const composerPickerText = (await composerPicker.innerText()).trim();

			if (composerPickerText !== expectedPickerText) {
				fails.push(
					`composer picker "${composerPickerText}" does not match settings default "${expectedPickerText}"`,
				);
			}

			const accessChip = page.getByTestId("access-chip");
			await expect(accessChip).toBeVisible();
			const accessText = (await accessChip.innerText()).trim();
			if (!perAgent.includes(accessText)) {
				fails.push(
					`composer permission "${accessText}" matches no Settings per-agent default [${perAgent.join(", ")}]`,
				);
			}
			const composerEffort = (
				await page.getByTestId("effort-chip").innerText()
			).trim();
			if (composerEffort !== settingsEffort) {
				fails.push(
					`composer effort "${composerEffort}" does not match Settings "${settingsEffort}"`,
				);
			}

			return verdict(
				fails,
				`composer pickers match Settings defaults: agent/model "${composerPickerText}", permission "${accessText}" (Settings per agent: ${perAgent.join("/")}), effort "${composerEffort}"`,
			);
		},
	},
	{
		item: "18.6",
		async run({ page, open, browser, sim }) {
			const fails: string[] = [];

			// Mint non-operator pairing token for a paired device
			const simDir = resolve(process.env.BAR_SIM_DIR ?? "../../.sim-checks");
			const state = JSON.parse(
				readFileSync(join(simDir, "state.json"), "utf8"),
			);
			const out = execSync("pnpm --silent --filter prismalens dev pair", {
				encoding: "utf8",
				cwd: resolve(import.meta.dirname, "../../../.."),
				env: { ...process.env, PRISMALENS_WORKSPACE_DIR: state.workspace },
			});
			const token = out.match(/\/pair#([A-Za-z0-9_-]+)/)?.[1];
			if (!token) {
				fails.push("could not mint non-operator pairing token");
				return verdict(fails, "failed to mint paired device link");
			}

			// Open paired device context
			// An empty storage state: a context made in a test otherwise inherits the host's pairing.
			const pairedCtx = await browser.newContext({
				baseURL: sim.url,
				storageState: { cookies: [], origins: [] },
			});
			const pairedPage = await pairedCtx.newPage();
			try {
				await pairedPage.goto(`/pair#${token}`);
				await pairedPage.waitForURL(/\/(new|incidents|threads)/);

				// Navigate paired device to organizer settings (Agent-started threads)
				await pairedPage.goto("/settings?tab=organizer");
				await expect(pairedPage.getByTestId("settings-title")).toBeVisible({
					timeout: 30_000,
				});
				const hostOnlyNotes = pairedPage.getByTestId("host-only");
				try {
					await expect(hostOnlyNotes.first()).toBeVisible({ timeout: 30_000 });
				} catch (e) {
					const seen = await pairedPage
						.locator("main")
						.innerText()
						.catch(() => "");
					throw new Error(
						`no host-only note on the paired device at ${pairedPage.url()}: ${seen.replace(/\s+/g, " ").slice(0, 300)}`,
						{ cause: e },
					);
				}

				const noteText = await hostOnlyNotes.first().innerText();
				if (
					!noteText.includes(
						"Only the computer running PrismaLens can change this.",
					)
				) {
					fails.push(`host-only row note text unexpected: "${noteText}"`);
				}

				// The control on host-only row is disabled on paired device
				const startTrigger = pairedPage.getByTestId("agent-threads-start");
				await expect(startTrigger).toBeVisible();
				const isDisabled = await startTrigger.isDisabled();
				if (!isDisabled) {
					fails.push("paired device control on host-only row is not disabled");
				}

				// On the host machine (page), verify the row is not locked and is editable
				await open("/settings?tab=organizer");
				const hostTrigger = page.getByTestId("agent-threads-start");
				await expect(hostTrigger).toBeVisible();
				if ((await page.getByTestId("host-only").count()) > 0) {
					fails.push("host-only note shown on the host device itself");
				}
				const isHostDisabled = await hostTrigger.isDisabled();
				if (isHostDisabled) {
					fails.push("host machine control on host-only row is disabled");
				}
			} finally {
				await pairedCtx.close();
			}

			return verdict(
				fails,
				"host-only row states 'Only the computer running PrismaLens can change this.' and is disabled on paired device, while editable on host",
			);
		},
	},
	{
		item: "18.7",
		async run({ device }) {
			const fails: string[] = [];
			const phone = await device({ width: 390, height: 844 });
			try {
				for (const { tab } of SETTINGS_PAGES) {
					await phone.goto(`/settings?tab=${tab}`);
					const title = phone.getByTestId("settings-title");
					await expect(title).toBeVisible({ timeout: 5_000 });
					const titleText = (await title.innerText()).trim();
					if (!titleText) {
						fails.push(`page ${tab} has no visible title on phone`);
					}
				}
			} finally {
				await phone.close();
			}

			return verdict(
				fails,
				`all ${SETTINGS_PAGES.length} settings pages reachable on 390 px phone with visible title`,
			);
		},
	},
]);
