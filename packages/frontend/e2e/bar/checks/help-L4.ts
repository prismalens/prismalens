// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Locator, type Page } from "@playwright/test";
import type { Ctx, Result } from "../bar";

/** Shared helpers for bar check categories 8, 9, 10 (#1101). */

export function getThreadRowWrap(page: Page, threadId: string): Locator {
	return page
		.locator('[data-testid="thread-row-wrap"]')
		.filter({ has: page.locator(`[data-id="${threadId}"]`) });
}

export async function createChatThread(
	page: Page,
	text: string,
): Promise<string> {
	const res = await page.request.post("/api/threads", {
		data: { text, subject: { kind: "none" } },
	});
	if (!res.ok()) {
		throw new Error(
			`createChatThread failed: ${res.status()} ${await res.text()}`,
		);
	}
	const json = (await res.json()) as { investigationId: string };
	return json.investigationId;
}

export async function waitForAsk(
	page: Page,
	threadId: string,
	timeoutMs = 15_000,
) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const res = await page.request.get("/api/threads/asks");
		if (res.ok()) {
			const json = (await res.json()) as {
				asks: Array<{
					ask: { threadId: string; askId: string; title: string };
				}>;
			};
			const found = json.asks.find((a) => a.ask.threadId === threadId);
			if (found) return found;
		}
		await page.waitForTimeout(500);
	}
	throw new Error(
		`waitForAsk timed out after ${timeoutMs} ms for thread ${threadId}`,
	);
}

/** Stops each thread's run, so a check leaves no live turn holding one of the host's run slots. */
export async function cancelThreads(page: Page, ids: string[]): Promise<void> {
	for (const id of ids)
		await page.request
			.post(`/api/investigations/${id}/cancel`, { data: {} })
			.catch(() => undefined);
}

/** A check that stops every thread it started, so none keeps one of the host's run slots. */
export const tracked =
	(run: (ctx: Ctx, made: string[]) => Promise<Result>) =>
	async (ctx: Ctx): Promise<Result> => {
		const made: string[] = [];
		try {
			return await run(ctx, made);
		} finally {
			await cancelThreads(ctx.page, made);
		}
	};

/** Hovering a list row shows its Answer button; the button opens the row's ask card beside it. */
export async function openAskCard(page: Page, wrap: Locator): Promise<Locator> {
	await wrap.hover();
	await wrap.getByTestId("row-answer").click();
	const card = page.getByTestId("row-ask-card");
	await expect(card).toBeVisible();
	return card;
}
