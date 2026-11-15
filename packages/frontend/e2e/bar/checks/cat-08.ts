// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";
import { defineChecks, notSetUp, verdict } from "../bar";
import {
	cancelThreads,
	createChatThread,
	getThreadRowWrap,
	openAskCard,
	tracked,
	waitForAsk,
} from "./help-L4";

/** The needs-you count the tab title leads with, once the app has set it; 0 when it shows none. */
const titleCount = async (page: Page): Promise<number> =>
	Number(/^\((\d+)\)/.exec(await page.title())?.[1] ?? 0);

/** A thread of its own, waiting on an approval (`ask`) or a question (`elicit`). */
async function askingThread(
	page: Page,
	script: "ask" | "elicit",
	tag: string,
	made: string[],
): Promise<string> {
	const id = await createChatThread(page, `fake-session:${script} ${tag}`);
	made.push(id);
	await waitForAsk(page, id);
	return id;
}

/** The composer's placeholder: the editor writes it on its empty first line. */
const placeholder = async (page: Page): Promise<string> =>
	(await page
		.getByTestId("composer-input")
		.locator("p[data-placeholder]")
		.getAttribute("data-placeholder")) ?? "";

/** #1101 category 8, Asks and approvals, including from another thread. */
export default defineChecks([
	{
		item: "8.1",
		run: tracked(async ({ page, open }, made) => {
			const id = await askingThread(page, "ask", "test-8-1", made);
			const fails: string[] = [];

			await open("/new");
			const asks = (await (
				await page.request.get("/api/threads/asks")
			).json()) as {
				asks: { ask: { threadId: string } }[];
			};
			const waiting = new Set(asks.asks.map((a) => a.ask.threadId)).size;
			await expect
				.poll(() => titleCount(page), { message: "tab title count" })
				.toBeGreaterThanOrEqual(waiting);
			const title = await page.title();

			const row = getThreadRowWrap(page, id).getByTestId("thread-row");
			await expect(row).toBeVisible();
			const detail =
				(
					await row
						.locator('[data-testid="row-cause"], [data-testid="row-detail"]')
						.first()
						.textContent()
				)?.trim() ?? "";
			const age =
				(await row.getByTestId("row-age").textContent())?.trim() ?? "";
			if (!detail) fails.push("list row has no line saying what is asked");
			if (!/^(now|\d+\s?(s|m|h|d))/.test(age))
				fails.push(`list row age reads "${age}", not how long ago`);

			await open(`/threads/${id}`);
			const dock = page.getByTestId("ask-dock");
			await expect(dock).toBeVisible();

			return verdict(
				fails,
				`waiting ask in the dock, in its list row ("${detail}", ${age}) and in the tab title "${title}" (${waiting} threads waiting)`,
			);
		}),
	},
	{
		item: "8.2",
		run: tracked(async ({ page, open }, made) => {
			const fails: string[] = [];
			const permId = await askingThread(page, "ask", "test-8-2p", made);
			const qId = await askingThread(page, "elicit", "test-8-2q", made);
			const asks = (await (
				await page.request.get("/api/threads/asks")
			).json()) as {
				asks: { ask: { threadId: string; kind: string } }[];
			};
			if (
				!asks.asks.some(
					(a) => a.ask.threadId === permId && a.ask.kind === "permission",
				)
			)
				fails.push("the ask thread's ask is not a permission ask");

			// Hovering the row offers Answer; its card holds the exact thing asked and the one-step choices.
			await open("/new");
			const permWrap = getThreadRowWrap(page, permId);
			const card = await openAskCard(page, permWrap);
			const subject =
				(await card.getByTestId("row-ask-subject").textContent())?.trim() ?? "";
			if (!subject) fails.push("the permission card shows no command or path");
			for (const id of [
				"row-ask-approve",
				"row-ask-decline",
				"row-ask-always",
				"row-ask-deny-reason",
			])
				if (!(await card.getByTestId(id).isVisible()))
					fails.push(`the permission card has no ${id}`);

			// A question answers by a click on its option.
			await permWrap.getByTestId("row-answer").click();
			await expect(page.getByTestId("row-ask-card")).toHaveCount(0);
			const qWrap = getThreadRowWrap(page, qId);
			await openAskCard(page, qWrap);
			await page.getByTestId("row-ask-option").first().click();
			await expect(qWrap.getByTestId("row-ask-answered")).toBeVisible({
				timeout: 10_000,
			});

			// And by its number key on the focused row.
			const qId2 = await askingThread(page, "elicit", "test-8-2k", made);
			await open("/new");
			const kWrap = getThreadRowWrap(page, qId2);
			await kWrap.getByTestId("thread-row").focus();
			await page.keyboard.press("Space");
			await expect(page.getByTestId("row-ask-card")).toBeVisible();
			await page.keyboard.press("1");
			await expect(kWrap.getByTestId("row-ask-answered")).toBeVisible({
				timeout: 10_000,
			});

			return verdict(
				fails,
				`hover offered Answer, whose card shows the command "${subject}" with Approve, Decline, Always and Deny with a reason; a question answered by a click, and another opened by Space on its focused row and answered by key 1`,
			);
		}),
	},
	{
		item: "8.3",
		run: tracked(async ({ page, open, device }, made) => {
			const threadId = await askingThread(page, "ask", "test-8-3", made);
			await open("/new");
			const wrap = getThreadRowWrap(page, threadId);
			await expect(wrap).toBeVisible();
			await expect
				.poll(() => titleCount(page), { message: "tab title count" })
				.toBeGreaterThan(0);
			const initialCount = await titleCount(page);

			const phone = await device();
			await phone.goto(`/threads/${threadId}`);
			const phoneDock = phone.getByTestId("ask-dock");
			await expect(phoneDock).toBeVisible();
			await phone.getByTestId("ask-dock-allow").click();
			await expect(phoneDock).toBeHidden({ timeout: 10_000 });

			// The first device's row says it, and its count drops.
			const elsewhere = wrap.getByTestId("row-ask-elsewhere");
			await expect(elsewhere).toBeVisible({ timeout: 15_000 });
			const noteText = (await elsewhere.textContent())?.trim();
			await expect
				.poll(() => titleCount(page), {
					message: "tab title count after the answer",
				})
				.toBeLessThan(initialCount);
			const newCount = await titleCount(page);
			await phone.context().close();

			const fails: string[] = [];
			if (noteText !== "Answered on another device")
				fails.push(`row note was "${noteText}"`);
			return verdict(
				fails,
				`answering on the phone changed the row to "${noteText}" and dropped the tab count from ${initialCount} to ${newCount}`,
			);
		}),
	},
	{
		item: "8.4",
		run: tracked(async ({ page, open }, made) => {
			const fails: string[] = [];

			// Escape hides the ask without answering; the box says typing declines with feedback.
			const hideId = await askingThread(page, "ask", "test-8-4h", made);
			await open(`/threads/${hideId}`);
			const dock = page.getByTestId("ask-dock");
			await expect(dock).toBeVisible();
			const hint = await placeholder(page);
			if (hint !== "Type to decline with feedback")
				fails.push(`composer placeholder was "${hint}"`);
			await dock.getByTestId("ask-dock-allow").focus();
			await page.keyboard.press("Escape");
			const hidden = page.getByTestId("ask-dock-hidden");
			await expect(hidden).toBeVisible();
			const stillWaiting = (
				(await (await page.request.get("/api/threads/asks")).json()) as {
					asks: { ask: { threadId: string } }[];
				}
			).asks.some((a) => a.ask.threadId === hideId);
			if (!stillWaiting)
				fails.push("Escape answered the ask instead of hiding it");
			await hidden.getByRole("button", { name: "Show" }).click();
			await expect(dock).toBeVisible();
			await cancelThreads(page, [hideId]);

			// One key approves.
			const yesId = await askingThread(page, "ask", "test-8-4y", made);
			await open(`/threads/${yesId}`);
			await expect(page.getByTestId("ask-dock")).toBeVisible();
			await page.getByTestId("composer-input").focus();
			await page.keyboard.press("Alt+y");
			await expect(page.getByTestId("ask-dock")).toHaveCount(0);

			// Another declines, and what was typed goes with it as feedback.
			const noId = await askingThread(page, "ask", "test-8-4n", made);
			await open(`/threads/${noId}`);
			await expect(page.getByTestId("ask-dock")).toBeVisible();
			const box = page.getByTestId("composer-input");
			await box.focus();
			await box.pressSequentially("too risky, use a temp dir");
			await page.keyboard.press("Alt+n");
			await expect(page.getByTestId("ask-dock")).toHaveCount(0);
			await expect(
				page.getByText("too risky, use a temp dir").first(),
			).toBeVisible();

			return verdict(
				fails,
				`Alt+Y approved and Alt+N declined with the typed feedback shown in the thread; Escape hid the ask while it stayed waiting; placeholder "${hint}"`,
			);
		}),
	},
	{
		item: "8.5",
		run: tracked(async ({ page, open }, made) => {
			const fails: string[] = [];
			const id = await askingThread(page, "ask", "test-8-5", made);

			// Only one ask waits per thread in every staged condition, so paging cannot be reached.
			await open(`/threads/${id}`);
			const pages = await page.getByTestId("ask-dock-page").count();

			// An ask from a run that ended shows as ended and offers no Approve.
			await page.getByTestId("composer-input").focus();
			await page.keyboard.press("Escape");
			await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
			await open("/new");
			const wrap = getThreadRowWrap(page, id);
			let ended = "no ask on the row after the run ended";
			if ((await wrap.getByTestId("row-answer").count()) === 0) {
				fails.push(
					"the run ended and its row shows no ask at all, ended or not",
				);
			} else {
				const card = await openAskCard(page, wrap);
				ended =
					(await card.getByTestId("row-ask-ended").textContent())?.trim() ?? "";
				if (ended !== "Ended")
					fails.push(`the ended ask's card read "${ended}"`);
				if (await card.getByTestId("row-ask-approve").isVisible())
					fails.push("the ended ask still offers Approve");
			}

			if (!fails.length && pages === 0)
				return notSetUp(
					`an ended ask reads "${ended}" with no Approve, but no sim thread holds two asks, so paging oldest first is unshown`,
				);
			return verdict(
				fails,
				`paging pages ${pages}; after the run ended its ask: ${ended}`,
			);
		}),
	},
	{
		item: "8.6",
		run: tracked(async ({ page, open }, made) => {
			const id = await askingThread(page, "ask", "test-8-6", made);
			await open(`/threads/${id}`);
			const dockWhy = page.getByTestId("ask-dock-why");
			await expect(dockWhy).toBeVisible();
			const whyText = (await dockWhy.textContent())?.trim() ?? "";

			await open("/new");
			const card = await openAskCard(page, getThreadRowWrap(page, id));
			const rowWhy = card.getByTestId("row-ask-why");
			await expect(rowWhy).toBeVisible();
			const rowWhyText = (await rowWhy.textContent())?.trim() ?? "";

			const fails: string[] = [];
			if (!/^Asked because this thread runs in .+\. Always .+\.$/.test(whyText))
				fails.push(
					`dock line "${whyText}" is not "Asked because <mode>. Always <what>."`,
				);
			if (!/Always (allows|stops)/.test(rowWhyText))
				fails.push(
					`row card line "${rowWhyText}" does not say what Always keeps`,
				);

			return verdict(
				fails,
				`dock says "${whyText}"; the row card says "${rowWhyText}"`,
			);
		}),
	},
	{
		item: "8.7",
		run: tracked(async ({ page, open }, made) => {
			const fails: string[] = [];
			await open("/new");
			await page.getByTestId("access-chip").click();
			const menu = page.getByTestId("access-menu");
			await expect(menu).toBeVisible();
			const options = menu.locator('[data-testid^="access-"]');
			const levels = await options.count();
			if (levels < 2) fails.push(`the mode picker lists ${levels} level(s)`);
			const tip = page.locator('[data-float="tip"]');
			let sentences = 0;
			for (let i = 0; i < levels; i++) {
				await options.nth(i).hover();
				await expect(tip.last()).toBeVisible();
				const text = (await tip.last().textContent())?.trim() ?? "";
				if (/^[^.!?]+[.!?]( The agent calls it [^.!?]+\.)?$/.test(text))
					sentences++;
				else
					fails.push(`level ${i} explained as "${text}", not in one sentence`);
			}
			await page.keyboard.press("Escape");

			// The card shows the mode the thread runs in: the same word as the thread's own chip.
			const id = await askingThread(page, "ask", "test-8-7", made);
			await open(`/threads/${id}`);
			await expect(page.getByTestId("ask-dock")).toBeVisible();
			const chipWord =
				(await page.getByTestId("access-chip").textContent())?.trim() ?? "";
			await open("/new");
			const card = await openAskCard(page, getThreadRowWrap(page, id));
			const cardMode = card.getByTestId("row-ask-mode");
			await expect(cardMode).toBeVisible();
			const modeText =
				(await cardMode.textContent())?.replace(/^\s*·\s*/, "").trim() ?? "";
			if (!chipWord || !modeText || chipWord !== modeText)
				fails.push(
					`card mode "${modeText}" is not the thread's mode "${chipWord}"`,
				);

			return verdict(
				fails,
				`${sentences} of ${levels} mode levels explained in one sentence; the card shows "${modeText}", the thread's own mode`,
			);
		}),
	},
]);
