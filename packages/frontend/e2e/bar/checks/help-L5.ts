// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Page } from "@playwright/test";

/** The row under the transcript scroller's top edge, by text and bounding top. */
export async function firstVisibleRow(
	page: Page,
): Promise<{ text: string; top: number }> {
	return page.evaluate(() => {
		const box = document
			.querySelector("[data-testid=transcript-scroller]")
			?.getBoundingClientRect();
		const y = (box?.top ?? 0) + 30;
		const row = Array.from(
			document.querySelectorAll<HTMLElement>(
				"[data-testid=transcript] [data-at]",
			),
		).find((r) => {
			const b = r.getBoundingClientRect();
			return b.top <= y && b.bottom > y;
		});
		return {
			text: (row?.textContent ?? "").trim().slice(0, 200),
			top: row?.getBoundingClientRect().top ?? -1,
		};
	});
}

/** Top coordinate of a row whose text starts with `prefix`. */
export async function topOfText(page: Page, prefix: string): Promise<number> {
	return page.evaluate(
		(t) =>
			Array.from(
				document.querySelectorAll<HTMLElement>(
					"[data-testid=transcript] [data-at]",
				),
			)
				.find((r) => (r.textContent ?? "").trim().startsWith(t))
				?.getBoundingClientRect().top ?? -999,
		prefix,
	);
}

/** Total rows currently mounted in the transcript DOM. */
export async function rowsInDom(page: Page): Promise<number> {
	return page.locator("[data-testid=transcript] [data-at]").count();
}

/**
 * Route a finished thread as live, and emit one live SSE frame when released.
 */
export async function liveStreamOnce(
	page: Page,
	id: string,
	text: string,
): Promise<{ release: () => void }> {
	await page.route(`**/api/investigations/${id}`, async (route) => {
		if (route.request().method() !== "GET") return route.fallback();
		const res = await route.fetch();
		const body = await res.json();
		await route.fulfill({
			response: res,
			json: { ...body, status: "running" },
		});
	});
	let release: () => void = () => {};
	const held = new Promise<void>((r) => {
		release = r;
	});
	await page.route(`**/api/investigations/${id}/stream?**`, async (route) => {
		await held;
		const event = {
			kind: "agent_step",
			runId: id,
			branchId: "main",
			path: [],
			seq: 9000,
			ts: new Date().toISOString(),
			text,
			toolCalls: [],
		};
		await route.fulfill({
			status: 200,
			headers: { "content-type": "text/event-stream" },
			body: `event: live\ndata: ${JSON.stringify({ gen: 0, event })}\n\n`,
		});
	});
	return { release: () => release() };
}
