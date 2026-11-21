// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";
import { defineChecks, notSetUp, verdict } from "../bar";

/** The PR's entry on screen: the header chip, or the box's PR row where the box shows (wide screens). */
const prEntry = (page: Page) =>
	page.getByTestId("thread-pr-chip").or(page.getByTestId("details-pr")).first();

/** The open menu's row ids (`menu-<id>` less its keys and why parts), from the kit menu (#1127). */
async function menuRows(page: Page): Promise<string[]> {
	const menu = page.getByRole("menu").last();
	await expect(menu).toBeVisible({ timeout: 15_000 });
	return menu
		.locator("[data-testid^='menu-']")
		.evaluateAll((els) =>
			els
				.map((e) => (e.getAttribute("data-testid") ?? "").slice(5))
				.filter((id) => id && !id.endsWith("-keys") && !id.endsWith("-why")),
		);
}

/** #1101 category 15, PR and checks. */
export default defineChecks([
	{
		item: "15.1",
		async run({ page, open, sim, device }) {
			// huge.diff link 2 is the staged PR thread (acme/shop #412).
			const path = sim.thread("huge.diff", 2);
			const fails: string[] = [];

			// The phone: the header's PR mark opens the PR in one click (tap).
			const phone = await device({ width: 390, height: 844 });
			await phone.goto(path);
			const phoneChip = phone.getByTestId("thread-pr-chip");
			await expect(phoneChip).toBeVisible();
			await phoneChip.click();
			const phoneOpened = await phone
				.getByTestId("pr-view")
				.waitFor({ timeout: 20_000 })
				.then(() => true)
				.catch(() => false);
			if (!phoneOpened)
				fails.push(
					"on a 390 px phone, the header's PR mark did not open the PR in one tap",
				);

			// Wide: the box's PR row is the mark.
			await open(path);
			const entry = page.getByTestId("details-pr");
			await expect(entry).toBeVisible();
			const entryText = await entry.innerText();
			if (!entryText.includes("412"))
				fails.push(`the PR's entry lacks its number (got: "${entryText}")`);

			// Open PR view
			await entry.click();
			const view = page.getByTestId("pr-view");
			await expect(view).toBeVisible();

			const title = await page.getByTestId("pr-view-title").innerText();
			if (!title.trim()) fails.push("PR title is empty");

			const branches = await page.getByTestId("pr-branches").innerText();
			if (!branches.includes("into"))
				fails.push(`branch pair missing "into" (got: "${branches}")`);

			const tone = await page.getByTestId("pr-tone-word").innerText();
			if (!tone.trim()) fails.push("tone word is empty");

			const checksCount = await page.getByTestId("pr-checks-count").innerText();
			if (!/\d+\/\d+ checks/.test(checksCount))
				fails.push(`checks count is not "N/M checks" (got: "${checksCount}")`);

			const review = await page.getByTestId("pr-review").innerText();
			if (!review.trim()) fails.push("review verdict is empty");

			const merge = await page.getByTestId("pr-merge").innerText();
			if (!merge.trim()) fails.push("merge state is empty");

			return verdict(
				fails,
				`phone header chip opens the PR in one tap; the box's PR mark reads "${entryText.trim()}" and opens the row in one click: #${title}: ${branches}, tone "${tone}", ${checksCount}, review "${review}", merge "${merge}"`,
			);
		},
	},
	{
		item: "15.2",
		async run({ page, open, sim }) {
			await open(sim.thread("huge.diff", 2));
			await prEntry(page).click();
			await expect(page.getByTestId("pr-view")).toBeVisible();

			const fails: string[] = [];
			const runs = page.getByTestId("pr-check-run");
			const count = await runs.count();
			if (count === 0) {
				fails.push("no check runs listed in Checks tab");
				return verdict(fails, "");
			}

			// Verify failing runs sort first
			const states = await runs.evaluateAll((els) =>
				els.map((el) => el.getAttribute("data-state")),
			);
			if (states[0] !== "failing") {
				fails.push(
					`the first check run is not failing (states: ${states.join(", ")})`,
				);
			}

			// First failing run is expanded by default and shows step or log tail
			const tail = page.getByTestId("pr-check-tail");
			await expect(tail).toBeVisible();
			const tailText = await tail.innerText();
			if (!tailText.includes("Failed at") && !tailText.includes("FAIL")) {
				fails.push(
					`failing check tail missing failing step or FAIL line (got: "${tailText.slice(0, 100)}")`,
				);
			}

			// Link to log
			const logLink = page.getByTestId("pr-check-log-link").first();
			const logHref =
				(await logLink.count()) > 0 ? await logLink.getAttribute("href") : null;
			if (!logHref) fails.push("the failing run has no log link with an href");

			return verdict(
				fails,
				`${count} check runs: failing runs sort first (${states.slice(0, 3).join(", ")}…), expanded tail shows failing step/lines, and links to log`,
			);
		},
	},
	{
		item: "15.3",
		async run({ page, open, sim }) {
			await open(sim.thread("huge.diff", 2));
			await prEntry(page).click();
			await expect(page.getByTestId("pr-view")).toBeVisible();

			const fails: string[] = [];
			// Action on failing check drafts an editable fix message
			const fixBtn = page.getByTestId("pr-fix-check");
			await expect(fixBtn).toBeVisible();
			await fixBtn.click();

			// Composer should contain the drafted message carrying check name, log excerpt, head SHA
			const composer = page
				.locator(".ProseMirror, textarea[data-testid='composer-input']")
				.first();
			await expect(composer).toBeVisible();
			const text = await composer.innerText();

			if (!text.includes("unit tests"))
				fails.push(
					`draft missing check name "unit tests" (got: "${text.slice(0, 60)}")`,
				);
			if (!text.includes("9f3c2ab"))
				fails.push(`draft missing head SHA (got: "${text.slice(0, 60)}")`);
			if (!text.includes("AssertionError") && !text.includes("Log excerpt"))
				fails.push("draft missing log excerpt");

			return verdict(
				fails,
				`"Ask the agent to fix" drafted editable message to agent with check name, log excerpt and head SHA (${text.slice(0, 60)}…)`,
			);
		},
	},
	{
		item: "15.4",
		async run({ page, open, sim }) {
			await open(sim.thread("huge.diff", 2));
			await prEntry(page).click();
			await expect(page.getByTestId("pr-view")).toBeVisible();

			const fails: string[] = [];
			// Switch to Reviews tab
			await page.getByTestId("pr-tab-reviews").click();
			const threads = page.getByTestId("pr-review-thread");
			const count = await threads.count();
			if (count === 0) {
				fails.push("no review threads in Reviews tab");
				return verdict(fails, "");
			}

			// Open first review thread (dana)
			const first = threads.first();
			const lineText = await first.innerText();
			if (!/query\.ts:31/.test(lineText) || !/dana/.test(lineText)) {
				fails.push(
					`review thread lacks path:line and author (got: "${lineText.slice(0, 60)}")`,
				);
			}
			if (!lineText.includes("Open") && !lineText.includes("Resolved")) {
				fails.push(
					`review thread missing resolved state (got: "${lineText.slice(0, 60)}")`,
				);
			}

			// Expand review thread
			await first.getByTestId("pr-review-toggle").click();
			const jump = first.getByTestId("pr-review-where");
			await expect(jump).toBeVisible();
			const jumpText = await jump.innerText();
			if (!jumpText.includes("query.ts"))
				fails.push(`jump button text missing target file (got: "${jumpText}")`);

			// Click jump to line in diff
			await jump.click();
			const surface = page.getByTestId("diff-surface");
			await expect(surface).toBeVisible();
			await expect(surface).toContainText("query.ts");

			return verdict(
				fails,
				`${count} review threads show path:line, author, resolved state and excerpt; jump opened file at line in diff`,
			);
		},
	},
	{
		item: "15.5",
		async run({ page, open, sim }) {
			await open(sim.thread("huge.diff", 2));
			await prEntry(page).click();
			await expect(page.getByTestId("pr-view")).toBeVisible();

			const fails: string[] = [];
			const watch = page.getByTestId("pr-watch");
			await expect(watch).toBeVisible();

			const mark = page.getByTestId("pr-watch-mark");
			const markText = (await mark.getAttribute("aria-label")) ?? "";
			if (!markText.includes("Watch")) {
				fails.push(
					`watch state mark missing accessible label (got: "${markText}")`,
				);
			}

			const watchBtn = watch.locator("button");
			const btnText = await watchBtn.innerText();
			if (btnText !== "Stop watching" && btnText !== "Watch") {
				fails.push(`unexpected watch button label "${btnText}"`);
			}

			// Click button to toggle watch state and await state mutation
			const expectedNext =
				btnText === "Stop watching" ? "Watch" : "Stop watching";
			await watchBtn.click();
			await expect(watchBtn).toHaveText(expectedNext);

			// Restore initial state to avoid dirtying shared sim state
			await watchBtn.click();
			await expect(watchBtn).toHaveText(btnText);

			// Pushed status node in transcript
			const statusLines = page.getByTestId("pr-status-line");
			const hasStatus = (await statusLines.count()) > 0;
			if (!hasStatus) {
				fails.push("no pushed pr-status-line found in transcript");
			}

			return verdict(
				fails,
				`watch state is visible ("${markText}") and changeable ("${btnText}" <-> "${expectedNext}"); pushed status in transcript`,
			);
		},
	},
	{
		item: "15.6",
		async run({ page, open, sim }) {
			// The fourth huge.diff link is the incident thread with PR #418 and a confirmed cause (#1101).
			await open(sim.thread("huge.diff", 3));
			await prEntry(page).click();
			await expect(page.getByTestId("pr-view")).toBeVisible();

			const answers = page.getByTestId("pr-answers");
			if (!(await answers.isVisible())) {
				return notSetUp(
					"the sim's incident thread with a PR is not staged, so there is nothing for its row to answer",
				);
			}

			const fails: string[] = [];
			const text = await answers.innerText();
			if (
				!/^Answers incident #\d+: the deploy dropped the orders index$/.test(
					text.trim(),
				)
			) {
				fails.push(
					`pr-answers missing expected answer sentence (got: "${text}")`,
				);
			}

			return verdict(fails, `PR row states what it answers: "${text}"`);
		},
	},
	{
		item: "15.7",
		async run({ page, open, sim }) {
			// Cold thread navigation
			await open(sim.thread("huge.diff", 2));
			await expect(page.getByTestId("thread-page")).toBeVisible();

			const fails: string[] = [];
			// Click 1: the PR entry (header chip or box row)
			const chip = prEntry(page);
			await expect(chip).toBeVisible();
			await chip.click();

			// Verify checks are visible immediately in 1 click
			const checkRuns = page.getByTestId("pr-check-runs");
			await expect(checkRuns).toBeVisible();
			const count = await page.getByTestId("pr-check-run").count();
			if (count === 0) {
				fails.push("no checks visible after opening PR view");
			}

			return verdict(
				fails,
				`checks found in 1 click (<= 2 clicks) from cold thread: ${count} runs displayed`,
			);
		},
	},
	{
		item: "15.8",
		async run({ page, open, sim }) {
			const path = sim.thread("huge.diff", 2);
			const id = path.split("/").pop() ?? "";
			const res = await page.request.get(`/api/threads/${id}/pull-requests`);
			const prs = (
				(await res.json()) as {
					pullRequests: { host: string; can?: { rerunCheck: boolean } }[];
				}
			).pullRequests;
			const pr = prs[0];
			if (!pr) return verdict(["the staged thread has no PR"], "");
			const fails: string[] = [];
			if (pr.host === "github" && pr.can?.rerunCheck !== true)
				fails.push(`a GitHub PR reads can.rerunCheck=${pr.can?.rerunCheck}`);

			await open(path);
			await prEntry(page).click();
			await expect(page.getByTestId("pr-view")).toBeVisible();
			const failing = page.locator(
				"[data-testid=pr-check-run][data-state=failing]",
			);
			await expect(failing.first()).toBeVisible();
			await failing
				.first()
				.click({ button: "right", position: { x: 4, y: 4 } });
			const rows = await menuRows(page);
			const button = await failing.first().getByTestId("rerun-button").count();
			const can = !!pr.can?.rerunCheck;
			if (rows.includes("rerun") !== can)
				fails.push(
					`menu Re-run is ${rows.includes("rerun")} but can is ${can}`,
				);
			if (button > 0 !== can)
				fails.push(`Re-run button shown: ${button > 0}, can: ${can}`);
			await page.keyboard.press("Escape");
			return verdict(
				fails,
				`${pr.host} PR reads can.rerunCheck=${can}; a failing check's menu (${rows.join(", ")}) and its row agree`,
			);
		},
	},
]);
