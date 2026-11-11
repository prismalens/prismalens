// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execSync } from "node:child_process";
import type { Page } from "@playwright/test";

/**
 * A long thread for the windowed transcript's journeys (#1101 categories 12-14):
 * `seed:long-thread` writes it into this stack's workspace, with its rail marks.
 */
export function seedLongThread(items?: number): { id: string; root: string } {
	const out = execSync(
		"pnpm --silent --filter @prismalens/api seed:long-thread",
		{
			encoding: "utf8",
			env: {
				...process.env,
				PRISMALENS_WORKSPACE_DIR: process.env.PRISMALENS_E2E_WORKSPACE_DIR,
				...(items ? { SEED_ITEMS: String(items) } : {}),
			},
		},
	);
	const id = /thread ([0-9a-f-]{36})/.exec(out)?.[1];
	const root = /tree root ([0-9a-f-]{36})/.exec(out)?.[1];
	if (!id || !root)
		throw new Error(`seed:long-thread printed no thread id:\n${out}`);
	return { id, root };
}

/**
 * Read a finished thread as live, and answer its stream once with one live frame
 * when `release` is called; the response then ends, which the browser reads as a drop.
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
