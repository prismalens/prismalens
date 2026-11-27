// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { defineChecks, verdict } from "../bar";

/** #1101 category 19, Command palette. */
export default defineChecks([
	{
		item: "19.1",
		async run({ page, open }) {
			const fails: string[] = [];
			await open("/new");
			await page.keyboard.press("Control+k");
			const input = page.getByTestId("thread-search-input");
			await expect(input).toBeVisible();

			const tabsNav = page.getByTestId("palette-tabs");
			await expect(tabsNav).toBeVisible();

			const expectedTabs = [
				"threads",
				"prs",
				"messages",
				"incidents",
				"alerts",
				"projects",
				"schedules",
				"actions",
			];
			const foundTabs: string[] = [];
			for (const id of expectedTabs) {
				const tab = page.getByTestId(`palette-tab-${id}`);
				if (await tab.isVisible()) {
					foundTabs.push(id);
				} else {
					fails.push(`missing tab: ${id}`);
				}
			}

			// When empty query: recents and actions are shown
			const recents = page.getByTestId("thread-search-result");
			await expect(recents.first()).toBeVisible({ timeout: 10_000 });
			const recentCount = await recents.count();
			if (recentCount === 0) {
				fails.push("no recent threads shown when query is empty");
			}

			const actions = page.locator('[data-testid^="thread-search-action-"]');
			const actionCount = await actions.count();
			if (actionCount === 0) {
				fails.push("no actions shown when query is empty");
			}

			await page.keyboard.press("Escape");

			return verdict(
				fails,
				`${foundTabs.length} type tabs verified; ${recentCount} recent threads and ${actionCount} actions listed when empty`,
			);
		},
	},
	{
		item: "19.2",
		async run({ page, open }) {
			const fails: string[] = [];
			await open("/new");
			await page.keyboard.press("Control+k");
			await expect(page.getByTestId("thread-search-input")).toBeVisible();

			const preview = page.getByTestId("palette-preview");
			await expect(preview).toBeVisible();

			// 1. A hovered thread previews its title, status word and last line
			const threadItems = page.getByTestId("thread-search-result");
			await expect(threadItems.first()).toBeVisible({ timeout: 10_000 });
			await threadItems.first().hover();
			const threadPreview = preview.getByTestId("palette-preview-thread");
			await expect(threadPreview).toBeVisible({ timeout: 5_000 });
			const lines = (await threadPreview.innerText())
				.split("\n")
				.map((l) => l.trim())
				.filter(Boolean);
			if (lines.length < 3) {
				fails.push(
					`thread preview lacks title, status and last line: [${lines.join(" | ")}]`,
				);
			}

			// 2. A hovered PR previews its number and checks
			await page.getByTestId("palette-tab-prs").click();
			const prItems = page.getByTestId("thread-search-pr");
			await expect(prItems.first()).toBeVisible({ timeout: 10_000 });
			await prItems.first().hover();
			const prLine = preview.getByTestId("palette-preview-pr");
			await expect(prLine).toBeVisible({ timeout: 5_000 });
			const prText = (await prLine.innerText()).replace(/\s+/g, " ");
			if (!/#\d+ .*(failing|passing|running|checks)/i.test(prText)) {
				fails.push(`PR preview lacks number and checks: "${prText}"`);
			}

			// 3. A limited thread previews its limit and reset
			await page.getByTestId("palette-tab-threads").click();
			// OpenCode names no thread (80cb358d5), so the limit thread reads its alert's name,
			// "Simulated limit-mid-turn …", where a named one reads "Session limit mid-turn …".
			await page.getByTestId("thread-search-input").fill("limit");
			const limited = page
				.getByTestId("thread-search-result")
				.filter({ hasText: /limit-mid-turn|Session limit mid-turn/ });
			await expect(limited.first()).toBeVisible({ timeout: 10_000 });
			await limited.first().hover();
			await expect(preview).toContainText(/Limited/);
			const limitText = (await preview.innerText()).replace(/\s+/g, " ");
			if (!/Resumes \d{1,2}:\d{2}/.test(limitText)) {
				fails.push(
					`limited thread preview shows no reset time: "${limitText}"`,
				);
			}

			await page.keyboard.press("Escape");

			return verdict(
				fails,
				`thread preview [${lines.join(" | ")}]; PR preview "${prText}"; limited thread preview "${limitText}"`,
			);
		},
	},
	{
		item: "19.3",
		async run({ page, open }) {
			const fails: string[] = [];
			await open("/new");
			await page.keyboard.press("Control+k");
			await expect(page.getByTestId("thread-search-input")).toBeVisible();

			// Verify footer lists the keys
			const footer = page.getByTestId("palette-keys");
			await expect(footer).toBeVisible();
			const footerText = await footer.innerText();
			const expectedKeys = ["Enter", "Alt", "Tab", "Esc"];
			for (const key of expectedKeys) {
				if (!footerText.includes(key)) {
					fails.push(`footer missing shortcut key "${key}": "${footerText}"`);
				}
			}

			// Open row actions with Alt+Enter on the selected thread
			const threadItems = page.getByTestId("thread-search-result");
			await expect(threadItems.first()).toBeVisible({ timeout: 10_000 });
			await threadItems.first().hover();

			await page.keyboard.press("Alt+Enter");

			// The actions' ids come from the thread registry, so they are read by their words.
			const actions = page.locator('[data-testid^="palette-row-action-"]');
			await expect(actions.first()).toBeVisible({ timeout: 15_000 });
			const words = (await actions.allInnerTexts()).map((t) => t.trim());
			const panelAction = actions.first();
			if (!words.some((w) => /^Open\b/.test(w))) {
				fails.push(`row actions [${words.join(", ")}] hold no Open`);
			}
			if (!words.some((w) => /^Settle\b/.test(w))) {
				fails.push(`row actions [${words.join(", ")}] hold no Settle`);
			}
			if (!words.some((w) => /^Copy link\b/.test(w))) {
				fails.push(`row actions [${words.join(", ")}] hold no Copy link`);
			}

			// Esc in row actions goes back to search results
			await page.keyboard.press("Escape");
			if (await panelAction.isVisible()) {
				fails.push("Escape did not dismiss row actions back to results");
			}

			// Second Esc closes the palette
			await page.keyboard.press("Escape");
			await expect(page.getByTestId("thread-search-input")).not.toBeVisible();

			return verdict(
				fails,
				`footer lists keys (${expectedKeys.join(", ")}); Alt+Enter opens row actions (panel, settle, copy link) and Esc steps back`,
			);
		},
	},
	{
		item: "19.4",
		async run({ page, open }) {
			const fails: string[] = [];
			await open("/new");
			await page.keyboard.press("Control+k");
			await expect(page.getByTestId("thread-search-input")).toBeVisible();

			// 1. The actions tab lists actions, and typing each one's name finds it
			await page.getByTestId("palette-tab-actions").click();
			const input = page.getByTestId("thread-search-input");
			const actions = page.locator('[data-testid^="thread-search-action-"]');
			await expect(actions.first()).toBeVisible({ timeout: 10_000 });
			const listed = await actions.evaluateAll((els) =>
				els.map((el) => ({
					id: el.getAttribute("data-testid") ?? "",
					name: ((el as HTMLElement).innerText.split("\n")[0] ?? "").trim(),
				})),
			);
			const actionCount = listed.length;
			if (actionCount < 5) {
				fails.push(`only ${actionCount} actions listed on the actions tab`);
			}
			for (const a of listed) {
				await input.fill(a.name);
				if ((await page.getByTestId(a.id).count()) === 0) {
					fails.push(`typing "${a.name}" does not find its action ${a.id}`);
				}
			}

			// 2. Message text across threads is found, and the snippet shows the match
			await input.fill("");
			await page.getByTestId("palette-tab-messages").click();
			await input.fill("checkout");

			const messages = page.getByTestId("thread-search-message");
			await expect(messages.first()).toBeVisible({ timeout: 10_000 });
			const messageCount = await messages.count();
			const snippets = await messages.allInnerTexts();
			const missing = snippets.filter((t) => !/checkout/i.test(t));
			if (missing.length > 0) {
				fails.push(
					`${missing.length} message hits do not show "checkout": "${missing[0]}"`,
				);
			}

			await page.keyboard.press("Escape");

			return verdict(
				fails,
				`${actionCount} actions listed and each found by typing its name; message search found ${messageCount} hits across threads, each snippet showing "checkout"`,
			);
		},
	},
]);
