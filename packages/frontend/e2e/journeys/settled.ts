// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Page, Request } from "@playwright/test";

/** Requests that stay open by design; `networkidle` would wait on them forever. */
const STREAMING = /\/api\/live\/changes|\/stream(\?|$)/;
const QUIET_MS = 500;

const inFlight = new WeakMap<Page, Set<Request>>();

/** Start counting a page's requests; call before the first navigation. */
export function trackRequests(page: Page): void {
	if (inFlight.has(page)) return;
	const open = new Set<Request>();
	inFlight.set(page, open);
	page.on("request", (r) => {
		if (!STREAMING.test(r.url())) open.add(r);
	});
	page.on("requestfinished", (r) => open.delete(r));
	page.on("requestfailed", (r) => open.delete(r));
	// A navigation abandons the old document's requests without always reporting them.
	page.on("framenavigated", (f) => {
		if (f === page.mainFrame()) open.clear();
	});
}

/** Like `networkidle`, but blind to the app's long-lived event streams (walk f27). */
export async function settled(page: Page, timeoutMs = 15_000): Promise<void> {
	trackRequests(page);
	const open = inFlight.get(page) ?? new Set<Request>();
	const deadline = Date.now() + timeoutMs;
	let quietSince = Date.now();
	while (Date.now() - quietSince < QUIET_MS) {
		if (open.size > 0) quietSince = Date.now();
		if (Date.now() > deadline) {
			throw new Error(
				`still waiting on ${[...open].map((r) => r.url()).join(", ")}`,
			);
		}
		await page.waitForTimeout(50);
	}
}
