// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { defineChecks, notSetUp, verdict } from "../bar";
import {
	clearComposer,
	getEditorState,
	settledRows,
	visitComposer,
} from "./help-L3";

/** #1101 category 6: Composer menus (/, @, #, the agent's own commands, pickers). */
export default defineChecks([
	{
		item: "6.1",
		async run({ page, open }) {
			const input = await visitComposer(page, open);
			const fails: string[] = [];
			const triggers = ["/", "@", "#"] as const;
			const rowsPer: string[] = [];
			let recents = 0;

			for (const trig of triggers) {
				await input.focus();
				await input.pressSequentially(trig);
				const menu = page.getByTestId("composer-menu");
				await expect(menu).toBeVisible();
				const menuTrigger = await menu.getAttribute("data-trigger");
				if (menuTrigger !== trig)
					fails.push(`trigger ${trig}: menu has data-trigger="${menuTrigger}"`);
				const rows = await settledRows(page);
				const count = await rows.count();
				rowsPer.push(`${trig} ${count}`);
				// "#" lists work items only from a connected source; the sim has none.
				if (count === 0 && trig !== "#") fails.push(`${trig}: 0 rows shown`);

				if (trig === "@") {
					recents = await menu
						.locator('[data-testid="composer-menu-group"][data-group="Recent"]')
						.getByTestId("composer-menu-row")
						.count();
					if (recents === 0)
						fails.push("@ with an empty query shows no Recent rows");
				}

				for (let i = 0; i < Math.min(count, 5); i++) {
					const row = rows.nth(i);
					if ((await row.getByTestId("composer-menu-icon").count()) === 0)
						fails.push(`${trig} row ${i}: no type icon`);
					const title =
						(
							await row.locator("span.shrink-0.truncate").first().textContent()
						)?.trim() ?? "";
					if (!title) fails.push(`${trig} row ${i}: empty title`);
					const whyEl = row.getByTestId("composer-menu-why");
					const why =
						(await whyEl.count()) > 0
							? ((await whyEl.textContent())?.trim() ?? "")
							: "";
					const whole = (await row.textContent())?.trim() ?? "";
					const second = whole.replace(title, "").replace(why, "").trim();
					if (!second) fails.push(`${trig} row "${title}": no secondary text`);
					const group = await row
						.locator("xpath=ancestor::*[@data-testid='composer-menu-group']")
						.getAttribute("data-group");
					if (!group) fails.push(`${trig} row "${title}": not in a group`);
				}

				await page.keyboard.press("Escape");
				await clearComposer(page);
			}

			return verdict(
				fails,
				`one menu for /, @, #: rows ${rowsPer.join(", ")}; each of the first five rows had an icon, a title, secondary text and a group; @ empty query listed ${recents} Recent rows`,
			);
		},
	},

	{
		item: "6.2",
		async run({ page, open }) {
			const input = await visitComposer(page, open);
			const fails: string[] = [];
			const menu = page.getByTestId("composer-menu");

			// Arrows wrap and focus stays in the box, on the first of / and @ with two rows or more.
			let wrapped = "";
			for (const trig of ["/", "@"]) {
				await clearComposer(page);
				await input.pressSequentially(trig);
				const rows = await settledRows(page);
				const count = await rows.count();
				if (count < 2) continue;
				if ((await rows.nth(0).getAttribute("aria-selected")) !== "true")
					fails.push(`${trig}: the first row is not the active one`);
				await page.keyboard.press("ArrowUp");
				if (
					(await rows.nth(count - 1).getAttribute("aria-selected")) !== "true"
				)
					fails.push(`${trig}: ArrowUp did not wrap to row ${count}`);
				await page.keyboard.press("ArrowDown");
				if ((await rows.nth(0).getAttribute("aria-selected")) !== "true")
					fails.push(`${trig}: ArrowDown did not wrap to row 1`);
				const focused = await page.evaluate(
					() => document.activeElement?.getAttribute("data-testid") ?? "",
				);
				if (focused !== "composer-input")
					fails.push(`focus left the box for "${focused}"`);
				wrapped = `${trig} (${count} rows)`;
				break;
			}
			if (!wrapped) fails.push("neither / nor @ listed two rows to wrap over");

			// A space ends the query: the menu closes and the text stays.
			await page.keyboard.press("Escape");
			await clearComposer(page);
			await input.pressSequentially("/help");
			await expect(menu).toBeVisible();
			await page.keyboard.press("Space");
			await expect(menu).toHaveCount(0);
			const afterSpace = (await getEditorState(page))?.text;
			if (afterSpace !== "/help ")
				fails.push(`after a space the text was "${afterSpace}"`);

			// Escape closes and leaves the text.
			await clearComposer(page);
			await input.pressSequentially("@leave_query");
			await expect(menu).toBeVisible();
			await page.keyboard.press("Escape");
			await expect(menu).toHaveCount(0);
			const leftText = (await getEditorState(page))?.text;
			if (leftText !== "@leave_query")
				fails.push(`Escape left "${leftText}", not "@leave_query"`);

			// Tab picks the active row into a chip.
			await clearComposer(page);
			await input.pressSequentially("@");
			await settledRows(page);
			await page.keyboard.press("Tab");
			await expect(menu).toHaveCount(0);
			await expect(page.locator(".composer-chip")).toHaveCount(1);

			// A boosted row says why, in the app's words for each boost (the API's answer is mocked here).
			await clearComposer(page);
			const hit = (id: string, why: string) => ({
				ref: { kind: "thread", id, label: `Boosted ${why}` },
				source: "records",
				group: "Threads",
				why,
				score: 1,
				detail: "running",
			});
			await page.route("**/api/references/search*", (route) =>
				route.fulfill({
					contentType: "application/json",
					json: {
						hits: [
							hit("t-open", "open"),
							hit("t-agent", "agent"),
							hit("t-used", "used"),
						],
						truncated: false,
						unavailable: [],
					},
				}),
			);
			let whys: string[] = [];
			try {
				await input.pressSequentially("@boost");
				const rows = await settledRows(page);
				await expect(rows).toHaveCount(3);
				whys = await rows.getByTestId("composer-menu-why").allTextContents();
			} finally {
				await page.unrouteAll({ behavior: "ignoreErrors" });
			}
			if (whys.join("|") !== "Open|Agent used|Recent")
				fails.push(
					`boost words were "${whys.join("|")}", not "Open|Agent used|Recent"`,
				);

			// Ranking is the API's: prefix first, then word start, then the rest, over the real search.
			await page.keyboard.press("Escape");
			await clearComposer(page);
			let ranked = "";
			for (const q of ["re", "te", "st", "pl", "ch"]) {
				const answer = page.waitForResponse(
					(r) =>
						r.url().includes("/api/references/search") &&
						r.url().includes(`q=${q}`),
				);
				await input.pressSequentially(`@${q}`);
				const body = (await (await answer).json()) as {
					hits: { ref: { kind: string; label: string } }[];
				};
				const tiers = body.hits
					.filter((h) => h.ref.kind !== "file" && h.ref.kind !== "folder")
					.map((h) => {
						const label = h.ref.label.toLowerCase().replace(/^[/@#]+/, "");
						if (label.startsWith(q)) return 1;
						const wordStart = label
							.split(/[^a-z0-9]+/)
							.some((w) => w.startsWith(q));
						return wordStart ? 2 : 3;
					});
				await page.keyboard.press("Escape");
				await clearComposer(page);
				if (new Set(tiers).size < 2) continue;
				const sorted = tiers.every(
					(t, i) => i === 0 || (tiers[i - 1] ?? 0) <= t,
				);
				if (!sorted)
					fails.push(
						`"@${q}" ranked match tiers out of order: ${tiers.join("")}`,
					);
				ranked = `"@${q}" tiers ${tiers.join("")}`;
				break;
			}
			if (!ranked)
				fails.push(
					"no query gave results of two match tiers to check ranking on",
				);

			return verdict(
				fails,
				`arrows wrapped and kept focus on ${wrapped}; a space closed the menu and kept "/help "; Escape left "${leftText}"; Tab picked a chip; boost words "${whys.join("|")}"; ranking in order for ${ranked}`,
			);
		},
	},

	{
		item: "6.3",
		async run({ page, open }) {
			const input = await visitComposer(page, open);
			const fails: string[] = [];

			await input.pressSequentially("/");
			await settledRows(page);
			const menu = page.getByTestId("composer-menu");
			const agentRows = menu.locator(
				'[data-testid="composer-menu-row"][data-ref^="command:agent:"]',
			);
			const agentCount = await agentRows.count();
			if (agentCount === 0) fails.push("no agent command listed under /");
			let described = 0;
			let hinted = -1;
			for (let i = 0; i < agentCount; i++) {
				const row = agentRows.nth(i);
				if ((await row.locator("span.truncate.text-meta").count()) > 0)
					described++;
				if (
					hinted < 0 &&
					(await row.locator("span.font-mono.text-meta").count()) > 0
				)
					hinted = i;
			}
			if (agentCount > 0 && described !== agentCount)
				fails.push(
					`${agentCount - described} of ${agentCount} agent commands lack a description`,
				);

			let ghostText = "";
			if (hinted < 0) {
				fails.push("no agent command with an argument hint to pick");
			} else {
				const row = agentRows.nth(hinted);
				const hint =
					(
						await row.locator("span.font-mono.text-meta").textContent()
					)?.trim() ?? "";
				await row.click();
				const ghost = page.getByTestId("composer-ghost");
				await expect(ghost).toBeVisible();
				ghostText = (await ghost.textContent())?.trim() ?? "";
				if (ghostText !== hint)
					fails.push(`ghost text "${ghostText}" is not the hint "${hint}"`);
			}

			await clearComposer(page);
			return verdict(
				fails,
				`${agentCount} agent commands under /, ${described} with a description; picking one showed its hint "${ghostText}" as ghost text`,
			);
		},
	},

	{
		item: "6.4",
		async run({ page, open }) {
			await visitComposer(page, open);
			const fails: string[] = [];
			const chips = {
				model: page.getByTestId("agent-picker"),
				effort: page.getByTestId("effort-chip"),
				permission: page.getByTestId("access-chip"),
			};
			const words: string[] = [];
			for (const [name, chip] of Object.entries(chips)) {
				await expect(chip).toBeVisible();
				const word = (await chip.textContent())?.trim() ?? "";
				words.push(`${name} "${word}"`);
				if (!word) fails.push(`${name} control has no word`);
				if ((await chip.locator("svg").count()) === 0)
					fails.push(`${name} control has no icon`);
			}

			// The permission picker: one sentence per level, a warn mark above the default.
			await chips.permission.click();
			const menu = page.getByTestId("access-menu");
			await expect(menu).toBeVisible();
			const options = menu.locator('[data-testid^="access-"]');
			const levels = await options.count();
			if (levels < 2) fails.push(`permission picker lists ${levels} level(s)`);
			const tip = page.locator('[data-float="tip"]');
			let sentences = 0;
			for (let i = 0; i < levels; i++) {
				await options.nth(i).hover();
				await expect(tip.last()).toBeVisible();
				const text = (await tip.last().textContent())?.trim() ?? "";
				if (/^[^.!?]+[.!?]( The agent calls it [^.!?]+\.)?$/.test(text))
					sentences++;
				else
					fails.push(`level ${i} explanation is not one sentence: "${text}"`);
			}
			const warns = await menu
				.locator("svg[aria-label]:not([aria-label='Current'])")
				.count();

			await page.keyboard.press("Escape");

			// A locked control says why when it is clicked.
			let lockedWhy = "";
			const locked = page.locator("[data-locked]");
			if ((await locked.count()) === 0) {
				fails.push("no footer control is locked, so no reason to check");
			} else {
				await locked.first().click({ force: true });
				await expect(tip.last()).toBeVisible();
				lockedWhy = (await tip.last().textContent())?.trim() ?? "";
				if (!lockedWhy) fails.push("a locked control gave no reason");
			}

			// The sim's agent offers no level above its default, so the warn mark can't be shown.
			if (!fails.length && warns === 0)
				return notSetUp(
					`the rest holds (${sentences} of ${levels} levels in one sentence, locked reason "${lockedWhy}"), but the sim's agent offers no level above its default to carry a warn mark`,
				);
			return verdict(
				fails,
				`footer controls ${words.join(", ")}, each with an icon; ${sentences} of ${levels} permission levels explained in one sentence; ${warns} warn mark(s); locked control says "${lockedWhy}"`,
			);
		},
	},

	{
		item: "6.5",
		async run({ page, open }) {
			await visitComposer(page, open);
			const fails: string[] = [];
			const accessChip = page.getByTestId("access-chip");
			await expect(accessChip).toBeVisible();

			const initialLevel = (await accessChip.textContent())?.trim() ?? "";

			// Shift+Tab cycles permission
			await page.keyboard.press("Shift+Tab");
			await expect
				.poll(async () => (await accessChip.textContent())?.trim())
				.not.toBe(initialLevel);
			const nextLevel = (await accessChip.textContent())?.trim() ?? "";
			if (nextLevel === initialLevel) {
				fails.push("Shift+Tab did not cycle permission");
			}

			// Alt+P opens the model list
			await page.keyboard.press("Alt+p");
			const modelList = page.getByTestId("agent-picker-list");
			await expect(modelList).toBeVisible();
			if ((await modelList.count()) === 0) {
				fails.push("Alt+P did not open the model list");
			}
			await page.keyboard.press("Escape");

			return verdict(
				fails,
				`Shift+Tab cycled permission from "${initialLevel}" to "${nextLevel}"; Alt+P opened model picker list`,
			);
		},
	},

	{
		item: "6.6",
		async run({ page, open }) {
			const input = await visitComposer(page, open);
			const fails: string[] = [];
			const sourceName = "GitHub Issues";
			const errorMsg = "Repository token expired, re-authenticate in Settings";

			await page.route("**/api/references/search*", async (route) => {
				await route.fulfill({
					contentType: "application/json",
					json: {
						hits: [],
						truncated: false,
						unavailable: [{ source: sourceName, message: errorMsg }],
					},
				});
			});

			try {
				await input.pressSequentially("#");
				const menu = page.getByTestId("composer-menu");
				await expect(menu).toBeVisible();

				const unavail = menu.getByTestId("composer-menu-unavailable");
				await expect(unavail).toBeVisible();
				const text = (await unavail.textContent())?.trim() ?? "";

				if (!text.includes(sourceName)) {
					fails.push(
						`unavailable notice "${text}" does not name source "${sourceName}"`,
					);
				}
				if (!text.includes(errorMsg)) {
					fails.push(
						`unavailable notice "${text}" does not include error message "${errorMsg}"`,
					);
				}

				await page.keyboard.press("Escape");
				await clearComposer(page);

				return verdict(
					fails,
					`unavailable source clearly displayed in composer menu: "${text}"`,
				);
			} finally {
				await page.unrouteAll({ behavior: "ignoreErrors" });
			}
		},
	},
]);
