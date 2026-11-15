// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { defineChecks, verdict } from "../bar";
import {
	cancelThreads,
	createChatThread,
	tracked,
	waitForAsk,
} from "./help-L4";

/** #1101 category 9, Tool rows. */
export default defineChecks([
	{
		item: "9.1",
		async run({ page, open, sim }) {
			// The standby thread's turn ran an ordinary command and scheduled a wake-up with PrismaLens's own tool.
			await open(sim.thread("host.standby", 0));
			await expect(page.getByTestId("thread-page")).toBeVisible({
				timeout: 45_000,
			});
			const fold = page
				.locator('[data-testid="turn-fold"], [data-testid="turn-fold-remote"]')
				.filter({ has: page.getByTestId("fold-pl") })
				.first();
			await expect(fold).toBeVisible({ timeout: 45_000 });
			const pl =
				(await fold.getByTestId("fold-pl").textContent())
					?.replace(/^\s*·\s*/, "")
					.trim() ?? "";
			const work =
				(await fold.locator("span.truncate").first().textContent())?.trim() ??
				"";

			const fails: string[] = [];
			if (
				!/^Worked\b.*(\b(Ran|Read|Searched|Used|Edited) \d+|\d+ steps?)/.test(
					work,
				)
			)
				fails.push(`the ordinary half reads "${work}", with no count of work`);
			if (!/^PrismaLens: [a-z]+ \d+ [a-z-]+/.test(pl))
				fails.push(
					`the PrismaLens half reads "${pl}", with no count of actions`,
				);
			if (work.includes("PrismaLens"))
				fails.push("PrismaLens actions are counted inside the ordinary half");
			if (/\b(Ran|Read|Searched|Used) \d+/.test(pl))
				fails.push("ordinary work is counted inside the PrismaLens half");

			return verdict(
				fails,
				`the turn's line counts ordinary work "${work}" and PrismaLens actions "${pl}" apart`,
			);
		},
	},
	{
		item: "9.3",
		run: tracked(async ({ page, open }, made) => {
			const fails: string[] = [];

			// A thread that ran commands, one of them refused, and is still running.
			const toolsId = await createChatThread(
				page,
				"fake-session:tools test-9-3",
			);
			made.push(toolsId);
			await open(`/threads/${toolsId}`);
			await expect(page.getByTestId("thread-page")).toBeVisible();
			const expandGroup = page.getByTestId("tools-expand").first();
			await expect(expandGroup).toBeVisible({ timeout: 20_000 });
			await expandGroup.click();
			const steps = page.getByTestId("step");
			await expect(steps.first()).toBeVisible();
			const count = await steps.count();
			if (count < 2) fails.push(`only ${count} tool rows to check`);

			// Every row starts collapsed.
			const open0 = await steps
				.getByTestId("step-toggle")
				.evaluateAll(
					(els) =>
						els.filter((e) => e.getAttribute("aria-expanded") === "true")
							.length,
				);
			if (open0 !== 0)
				fails.push(`${open0} of ${count} rows opened by default`);
			if ((await page.getByTestId("step-body").count()) !== 0)
				fails.push("a row body is showing before any click");

			// A finished command opens to its input and its result.
			const done = steps
				.filter({ has: page.getByTestId("step-toggle") })
				.first();
			await done.getByTestId("step-toggle").click();
			const body = done.getByTestId("step-body");
			await expect(body).toBeVisible();
			const input =
				(
					await body.getByTestId("step-command").first().textContent()
				)?.trim() ?? "";
			const output =
				(await body.getByTestId("step-output").first().textContent())?.trim() ??
				"";
			if (!input) fails.push("the opened row shows no input");
			if (!output) fails.push("the opened row shows no result");

			// A failed row says why in its own line, before it is opened.
			const failedRow = steps.filter({
				has: page.locator('[data-testid="step-verb"]', { hasText: "Failed" }),
			});
			await expect(failedRow).toHaveCount(1);
			const inLine =
				(await failedRow.first().getByTestId("step-why").count()) > 0
					? ((
							await failedRow.first().getByTestId("step-why").textContent()
						)?.trim() ?? "")
					: "";
			await failedRow.first().getByTestId("step-toggle").click();
			const opened =
				(
					await failedRow
						.first()
						.getByTestId("step-output")
						.first()
						.textContent()
				)?.trim() ?? "";
			if (!inLine)
				fails.push(
					`the failed row's line gives no reason; it appears only once opened: "${opened}"`,
				);
			const whyText = inLine || opened;

			// Leave no running turn behind.
			await page.getByTestId("composer-input").focus();
			await page.keyboard.press("Escape");

			// A running row says what it is doing: a write waiting on approval.
			const askId = await createChatThread(page, "fake-session:ask test-9-3r");
			made.push(askId);
			await waitForAsk(page, askId);
			await open(`/threads/${askId}`);
			const waiting = page.locator('[data-testid="step"]', {
				has: page.locator('[data-testid="step-verb"]', { hasText: "Waiting" }),
			});
			await expect(waiting.first()).toBeVisible({ timeout: 20_000 });
			const doing =
				(
					await waiting.first().getByTestId("step-toggle").textContent()
				)?.trim() ?? "";
			if (!/^Waiting\s*\S/.test(doing))
				fails.push(`the waiting row reads "${doing}", not what it waits on`);

			return verdict(
				fails,
				`${count} rows collapsed by default; an opened row showed input "${input.slice(0, 40)}" and a result; the failed row says "${whyText.slice(0, 80)}"; the waiting row reads "${doing.slice(0, 60)}"`,
			);
		}),
	},
	{
		item: "9.4",
		async run({ page, open, sim }) {
			await open(sim.thread("huge.diff", 1));
			await expect(page.getByTestId("thread-page")).toBeVisible();

			const card = page.getByTestId("turn-changes").first();
			await expect(card).toBeVisible({ timeout: 15_000 });
			const label =
				(await card.getByTestId("turn-changes-toggle").textContent())?.trim() ??
				"";
			const numbers = card.getByTestId("turn-changes-open");
			const stats =
				(await numbers.textContent())?.replace(/\s+/g, " ").trim() ?? "";

			const fails: string[] = [];
			if (!/^Changed \d+ files?$/.test(label))
				fails.push(`the card's label was "${label}", not "Changed N files"`);
			if (!/^\+\d+ −\d+$/.test(stats))
				fails.push(`the card's numbers were "${stats}", not "+a −b"`);

			await numbers.click();
			await expect(page.getByTestId("diff-surface")).toBeVisible({
				timeout: 10_000,
			});

			return verdict(
				fails,
				`the turn ended with "${label} ${stats}"; the numbers opened the diff`,
			);
		},
	},
	{
		item: "9.5",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			// A tool group of more than 8 steps shows 3 at each end and folds the rest into "N more".
			let group = "";
			let folded = 0;
			let revealed = 0;
			// The view level is one setting per person; reset it before the page loads (Full draws no fold and is slow to click).
			const saved = (await (
				await page.request.get("/api/settings/person")
			).json()) as { values: Record<string, string> };
			await page.request.put("/api/settings/person", {
				data: { values: { ...saved.values, "pl.transcriptView": "standard" } },
			});
			for (const path of [
				sim.thread("seed: long-thread"),
				sim.thread("agent.runaway"),
			]) {
				await open(path);
				await expect(page.getByTestId("thread-page")).toBeVisible();
				// Folds exist at the Standard view only; the level is one setting per person, so another check may have left it on Full (#1101 cat 12.6).
				const headers = page.getByTestId("tools-expand");
				const n = await headers.count();
				for (let i = 0; i < n && !group; i++) {
					const header = headers.nth(i);
					const text = (await header.textContent()) ?? "";
					const size = (text.match(/\d+/g) ?? []).reduce(
						(s, m) => s + Number(m),
						0,
					);
					if (size < 9) continue;
					await header.scrollIntoViewIfNeeded();
					await header.click();
					const unfold = page.getByTestId("steps-unfold").first();
					if (!(await unfold.isVisible())) continue;
					group = `"${text.trim()}"`;
					folded = Number(
						/(\d+) more/.exec((await unfold.textContent()) ?? "")?.[1] ?? 0,
					);
					const before = await page.getByTestId("step").count();
					await unfold.click();
					await expect(unfold).toBeHidden();
					revealed = (await page.getByTestId("step").count()) - before;
					if (folded <= 0 || revealed < folded)
						fails.push(
							`the fold named ${folded} steps and opening showed ${revealed}`,
						);
				}
				if (group) break;
			}

			// Otherwise the runaway thread's long run: its ends stay in view around one fold line.
			let run = "";
			if (!group) {
				// The runaway thread is still open from the search above; a third load does not fit the check's 180 s on the slow link.
				// The Standard view folds a finished turn into one "Worked for" line; open it to reach the run's own fold.
				const turn = page.getByTestId("turn-fold").first();
				await turn.waitFor({ timeout: 30_000 }).catch(() => undefined);
				if (
					(await turn.getAttribute("aria-expanded").catch(() => null)) ===
					"false"
				)
					await turn.evaluate((el) => (el as HTMLElement).click());
				const fold = page.getByTestId("run-fold").first();
				await expect(fold).toBeVisible({ timeout: 30_000 });
				run = (await fold.textContent())?.trim() ?? "";
				const around = fold.locator("xpath=ancestor::li[1]");
				// The ends draw as the earlier rows load, later on the slow link (#1101 cat 9).
				await around
					.locator("xpath=following-sibling::li")
					.first()
					.waitFor({ timeout: 30_000 })
					.catch(() => undefined);
				await around
					.locator("xpath=preceding-sibling::li")
					.first()
					.waitFor({ timeout: 30_000 })
					.catch(() => undefined);
				if ((await around.locator("xpath=preceding-sibling::li").count()) === 0)
					fails.push("no row shows before the fold");
				if ((await around.locator("xpath=following-sibling::li").count()) === 0)
					fails.push("no row shows after the fold");
				const rows = Number(/(\d+) rows/.exec(run)?.[1] ?? 0);
				const listed = () => page.locator("li").count();
				const before = await listed();
				// The list re-renders while it loads, so a pointer click never finds the button stable on the slow link.
				await fold.evaluate((el) => (el as HTMLElement).click());
				await expect
					.poll(async () => (await listed()) - before, { timeout: 30_000 })
					.toBeGreaterThan(0)
					.catch(() => undefined);
				revealed = (await listed()) - before;
				if (rows === 0 || revealed < 1)
					fails.push(`"${run}" opened to ${revealed} more rows`);
			}

			return verdict(
				fails,
				group
					? `tool group ${group} showed its ends and folded ${folded} steps into "N more"; opening it showed ${revealed} more`
					: `no tool group of 9 or more steps is staged; the runaway run read "${run}" with rows on both sides, and opening it showed ${revealed} more rows; a flagged or asked step staying in view was not exercised`,
			);
		},
	},
]);
