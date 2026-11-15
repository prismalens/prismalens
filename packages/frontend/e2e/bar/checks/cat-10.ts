// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";
import { defineChecks, verdict } from "../bar";

interface Links {
	started: { id: string; title: string | null }[];
	startedBy: { id: string; title: string | null } | null;
}

/** A thread's start links as the API tells them: who it started and who started it. */
async function links(page: Page, id: string): Promise<Links> {
	const res = await page.request.get(`/api/threads/${id}/links`);
	if (!res.ok()) throw new Error(`links of ${id}: ${res.status()}`);
	return (await res.json()) as Links;
}

const idOf = (path: string) => path.split("?")[0]?.split("/").pop() ?? "";

/** Wheels the transcript up until the locator shows, for rows near the start of a long thread. */
async function scrollUpTo(page: Page, target: ReturnType<Page["getByTestId"]>) {
	await page.mouse.move(700, 300);
	for (let i = 0; i < 40 && !(await target.first().isVisible()); i++) {
		await page.mouse.wheel(0, -4000);
		await page.waitForTimeout(150);
	}
}

/** #1101 category 10, Sub-agents, threads that start threads, and messages. */
export default defineChecks([
	{
		item: "10.1",
		async run({ page, open, sim }) {
			await open(sim.thread("seed: subagents"));
			await expect(page.getByTestId("thread-page")).toBeVisible();
			// The finished turn is one folded line; its sub-agent nodes show when it opens.
			const fold = page.getByTestId("turn-fold").first();
			if (
				(await fold.isVisible()) &&
				(await fold.getAttribute("aria-expanded")) === "false"
			)
				await fold.click();
			const nodes = page.getByTestId("transcript-subagent");
			await expect(nodes.first()).toBeVisible({ timeout: 15_000 });
			const nodeCount = await nodes.count();
			const titles: string[] = [];
			const fails: string[] = [];
			for (let i = 0; i < nodeCount; i++) {
				const node = nodes.nth(i);
				titles.push(
					(
						await node.locator("span.font-medium").first().textContent()
					)?.trim() ?? "",
				);
				// A collapsed node is one line: none of the helper's own steps are rendered inside it.
				if ((await node.getByTestId("step").count()) > 0)
					fails.push(`sub-agent node ${i} shows its own steps`);
			}
			if (titles.some((t) => !t)) fails.push("a sub-agent node has no title");

			// The list: the parent is there (control); no row carries a sub-agent's title.
			const parent = "Send two helpers";
			const feed = async (search: string) =>
				JSON.stringify(
					await (
						await page.request.get(
							`/api/threads/feed?limit=100&search=${encodeURIComponent(search)}`,
						)
					).json(),
				);
			if (!(await feed(parent)).includes(`"title":"${parent}"`))
				fails.push(`control: the list has no "${parent}" thread`);
			for (const t of titles)
				if ((await feed(t)).includes(`"title":"${t}"`))
					fails.push(`sub-agent "${t}" is a row in the thread list`);

			return verdict(
				fails,
				`${nodeCount} sub-agent nodes in the transcript (${titles.join(", ")}), each a collapsed line; none is a row in the list while "${parent}" is`,
			);
		},
	},
	{
		item: "10.2",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			const starterPath = sim.thread("agent.message-loop");
			const starterId = idOf(starterPath);
			const tree = await links(page, starterId);
			const child = tree.started[0];
			if (!child)
				throw new Error("the sim's message-loop thread started no thread");

			// The starter shows a "Started thread X" row that links to the child.
			await open(starterPath);
			await expect(page.getByTestId("thread-page")).toBeVisible();
			const row = page.getByTestId("tree-started").filter({
				has: page.locator(`a[href$="/threads/${child.id}"]`),
			});
			await scrollUpTo(page, row);
			await expect(row.first()).toBeVisible({ timeout: 5_000 });
			const rowText = (await row.first().textContent())?.trim() ?? "";
			if (!rowText.startsWith("Started thread"))
				fails.push(`the starter's row reads "${rowText}"`);

			// The child carries a started-by mark that links back to the starter.
			await open(`/threads/${child.id}`);
			await expect(page.getByTestId("thread-page")).toBeVisible();
			const mark = page.getByTestId("thread-parent");
			await expect(mark).toBeVisible();
			const href = (await mark.getAttribute("href")) ?? "";
			if (!href.endsWith(`/threads/${starterId}`))
				fails.push(`the started-by mark links to "${href}", not the starter`);
			const label = (await mark.getAttribute("aria-label")) ?? "";

			return verdict(
				fails,
				`the starter's row "${rowText}" links to "${child.title}"; the child's mark "${label}" links back to the starter`,
			);
		},
	},
	{
		item: "10.3",
		async run({ page, open, sim }) {
			await open(sim.thread("agent.message-loop"));
			await expect(page.getByTestId("thread-page")).toBeVisible();
			const messages = page.getByTestId("tree-message");
			await expect(messages.first()).toBeVisible({ timeout: 15_000 });
			const sent = page.locator(
				'[data-testid="tree-message"][data-direction="sent"]',
			);
			const received = page.locator(
				'[data-testid="tree-message"][data-direction="received"]',
			);
			const fails: string[] = [];
			if ((await sent.count()) === 0) fails.push("no sent message card");
			if ((await received.count()) === 0)
				fails.push("no received message card");

			let sentHead = "";
			let receivedHead = "";
			let peer = "";
			if (fails.length === 0) {
				const head = async (card: typeof sent) =>
					(await card.first().locator("p").first().textContent())?.trim() ?? "";
				sentHead = await head(sent);
				receivedHead = await head(received);
				if (!sentHead.startsWith("Messaged"))
					fails.push(`a sent card reads "${sentHead}"`);
				if (!receivedHead.startsWith("From"))
					fails.push(`a received card reads "${receivedHead}"`);
				const link = received.first().locator('a[href*="/threads/"]').first();
				peer = (await link.textContent())?.trim() ?? "";
				if (!peer) fails.push("the sender's title is not a link");
				if (!/\d{1,2}:\d{2}/.test(receivedHead))
					fails.push(`the card shows no time: "${receivedHead}"`);
			}

			// Text that is long enough to clamp opens and closes; the staged messages are short.
			const expand = messages.getByTestId("tree-message-expand").first();
			let expands =
				"no staged message is long enough to clamp, so expanding was not exercised";
			if ((await expand.count()) > 0) {
				await expand.click();
				await expect(expand).toHaveText("Show less");
				expands = "a long message expanded";
			}

			return verdict(
				fails,
				`received card "${receivedHead.slice(0, 50)}" and sent card "${sentHead.slice(0, 50)}" read differently; sender link "${peer}", time shown; ${expands}`,
			);
		},
	},
	{
		item: "10.4",
		async run({ page, open, sim }) {
			await open(sim.thread("agent.message-loop"));
			await expect(page.getByTestId("thread-page")).toBeVisible();
			const sent = page.locator(
				'[data-testid="tree-message"][data-direction="sent"]',
			);
			await expect(sent.first()).toBeVisible({ timeout: 15_000 });
			const known = ["next_pause", "steered", "reopened", "waiting"];
			const seen = new Set<string>();
			const fails: string[] = [];
			const count = await sent.count();
			for (let i = 0; i < count; i++) {
				const card = sent.nth(i);
				if ((await card.getAttribute("data-held")) !== null) continue;
				const outcome = await card
					.getByTestId("tree-message-outcome")
					.getAttribute("data-outcome");
				if (!outcome || !known.includes(outcome))
					fails.push(`sent message ${i} shows delivery "${outcome}"`);
				else seen.add(outcome);
			}
			if (seen.size === 0)
				fails.push("no sent message told its sender what happened");

			return verdict(
				fails,
				`${count} sent messages; each not held by the cap told the sender its delivery (${Array.from(seen).join(", ")}); running, idle and settled receivers were not all staged`,
			);
		},
	},
	{
		item: "10.5",
		async run({ page, open, sim }) {
			await open("/settings?tab=organizer");
			await expect(page.getByTestId("organizer-settings")).toBeVisible({
				timeout: 15_000,
			});
			const fails: string[] = [];
			const start =
				(await page.getByTestId("agent-threads-start").textContent())?.trim() ??
				"";
			if (!["Ask each time", "Allowed within limits", "Never"].includes(start))
				fails.push(`the start setting reads "${start}"`);
			const caps: string[] = [];
			for (const field of [
				"children",
				"perTree",
				"turnsPerDay",
				"pairPerDay",
			]) {
				const v =
					(
						await page.getByTestId(`agent-threads-${field}`).textContent()
					)?.trim() ?? "";
				if (!/^\d+$/.test(v)) fails.push(`cap ${field} reads "${v}"`);
				caps.push(`${field} ${v}`);
			}

			// A loop stops at the pair cap with a notice on the thread.
			await open(sim.thread("agent.message-loop"));
			await expect(page.getByTestId("thread-page")).toBeVisible();
			const notice = page.getByTestId("message-held").first();
			await expect(notice).toBeVisible({ timeout: 15_000 });
			const noticeText = (await notice.textContent())?.trim() ?? "";
			if (
				!/^Message loop stopped\./.test(noticeText) ||
				!/message cap/.test(noticeText)
			)
				fails.push(`the pair-cap notice reads "${noticeText}"`);

			return verdict(
				fails,
				`Settings: agents may start threads "${start}", caps ${caps.join(", ")}; the loop stopped with "${noticeText.slice(0, 90)}"; a start refused or capped by them was not exercised`,
			);
		},
	},
]);
