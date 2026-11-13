// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// time.zone (#1101): a thread opened in Asia/Kolkata with the en-IN locale. Stamps the
// times the page shows, what each says on hover, and a screenshot.
//   PRISMALENS_WORKSPACE_DIR=<ws> pnpm --filter @prismalens/frontend exec tsx e2e/conditions/helpers/time-zone.ts --url http://127.0.0.1:3410
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import {
	ACTIVE,
	connect,
	startThread,
	waitFor,
} from "../../../../../scripts/fakes/conditions/lib.mjs";
import {
	stampDir,
	writeStamp,
} from "../../../../../scripts/fakes/conditions/stamp.mjs";
import { cliArg, DESK, pairedContext, ZONE } from "./browser";

async function main() {
	const url = (cliArg("--url") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
	const { api, cookie } = await connect(url);
	const id =
		cliArg("--thread") ??
		(await startThread(api, "success", "Checkout 502s at night"));
	await waitFor(api, id, (r) => !ACTIVE.includes(r.status));
	const browser = await chromium.launch();
	try {
		const context = await pairedContext(browser, url, cookie, {
			...DESK,
			...ZONE,
		});
		const page = await context.newPage();
		await page.goto(`/threads/${id}`);
		await page
			.locator("time")
			.first()
			.waitFor({ state: "attached", timeout: 20_000 });
		await page.waitForTimeout(1500);
		// The thread's own times; a narrow rail may hide some, so visibility is kept per time.
		const times = await page.locator("time").evaluateAll((els) =>
			els.slice(0, 12).map((el) => ({
				text: el.textContent?.trim() ?? "",
				datetime: el.getAttribute("datetime"),
				title: el.getAttribute("title"),
				visible: (el as HTMLElement).offsetParent !== null,
			})),
		);
		const pageZone = await page.evaluate(
			() => Intl.DateTimeFormat().resolvedOptions().timeZone,
		);
		mkdirSync(stampDir(), { recursive: true });
		await page.screenshot({ path: join(stampDir(), "time.zone.png") });
		const detail = {
			threadId: id,
			pageZone,
			times,
			hoverNamesUtc: times.some((t) => /UTC|Z\b/.test(t.title ?? "")),
		};
		console.log(JSON.stringify(detail, null, 2));
		writeStamp({
			condition: "time.zone",
			simulator: "pw.time-zone",
			observed: {
				zoneApplied: pageZone === ZONE.timezoneId,
				timesShown: times.filter((t) => t.visible).length,
				hoverNamesUtc: detail.hoverNamesUtc,
			},
			detail,
			files: ["time.zone.png"],
		});
	} finally {
		await browser.close();
	}
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : String(e));
	process.exitCode = 1;
});
