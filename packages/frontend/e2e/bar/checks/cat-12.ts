// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { defineChecks, verdict } from "../bar";
import {
	firstVisibleRow,
	liveStreamOnce,
	rowsInDom,
	topOfText,
} from "./help-L5";

/** #1101 category 12, Long threads on a patchy network. */
export default defineChecks([
	{
		item: "12.1",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			const threadPath = sim.thread("seed: long-thread");
			const id = threadPath.split("/").pop() ?? "";

			const windowRequests: string[] = [];
			const eventsRequests: string[] = [];
			page.on("request", (r) => {
				const u = new URL(r.url());
				if (u.pathname === `/api/investigations/${id}/window`)
					windowRequests.push(u.search);
				if (u.pathname === `/api/investigations/${id}/events`)
					eventsRequests.push(u.search);
			});

			// Opens at the tail in one round trip
			await open(threadPath);
			await expect(page.getByText("Turn 242:").first()).toBeVisible({
				timeout: 60_000,
			});

			if (windowRequests.length !== 1) {
				fails.push(
					`expected 1 window request on initial open, saw ${windowRequests.length}`,
				);
			}
			if (eventsRequests.length > 0) {
				fails.push(
					`downloaded full event history (${eventsRequests.length} requests) instead of window alone`,
				);
			}

			// A hash-only goto would not reload the page, so leave it first.
			await page.goto("about:blank");
			const linked: string[] = [];
			page.on("request", (r) => {
				const u = new URL(r.url());
				if (u.pathname === `/api/investigations/${id}/window`)
					linked.push(u.search);
			});

			await open(`${threadPath}#item-main:70`);
			// Event 70 sits in a turn's steps, so the row that holds it is keyed by the first event of that group.
			const covering = () =>
				page.evaluate(() => {
					const seq = (k: string) => Number(k.split(":")[1]);
					const rows = Array.from(
						document.querySelectorAll<HTMLElement>(
							"[data-testid=transcript] [data-at]",
						),
					).filter((r) => seq(r.dataset.at ?? "") <= 70);
					const row = rows[rows.length - 1];
					if (!row) return null;
					const b = row.getBoundingClientRect();
					return {
						at: row.dataset.at ?? "",
						inView: b.bottom > 0 && b.top < window.innerHeight,
					};
				});
			await expect
				.poll(async () => (await covering())?.inView ?? false, {
					timeout: 40_000,
				})
				.toBe(true);
			const landed = await covering();
			if (Number(landed?.at.split(":")[1]) < 55) {
				fails.push(`#item-main:70 landed on ${landed?.at}, far from 70`);
			}
			if (linked.length !== 1 || !/at=main(%3A|:)70/.test(linked[0] ?? "")) {
				fails.push(
					`linked item should open with 1 window request at main:70, saw [${linked.join(" | ")}]`,
				);
			}

			return verdict(
				fails,
				`opened at tail in 1 window request with 0 full downloads, and #item-main:70 opened in 1 window request (${linked[0]}) landing on the row ${landed?.at} that holds it`,
			);
		},
	},
	{
		item: "12.2",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			const threadPath = sim.thread("seed: long-thread");
			const id = threadPath.split("/").pop() ?? "";

			await open(threadPath);
			await expect(page.getByText("Turn 242:").first()).toBeVisible({
				timeout: 60_000,
			});

			// 1. DOM stays bounded at 5,000+ items
			const count = await rowsInDom(page);
			if (count > 150) {
				fails.push(
					`DOM has ${count} items; expected bounded (<150) for 5,000-item thread`,
				);
			}

			// 2. Scroll holds while a page is prepended
			const scroller = page.getByTestId("transcript-scroller");
			const prepended = page.waitForResponse(
				(r) =>
					r.url().includes(`/api/investigations/${id}/window/page`) &&
					r.url().includes("before="),
				{ timeout: 40_000 },
			);
			await scroller.evaluate((el) => {
				el.scrollTop = 200;
			});
			await page.waitForTimeout(300);
			const seen = await firstVisibleRow(page);
			if (!seen.text)
				fails.push("could not identify first visible row before prepend");

			await prepended;
			await page.waitForTimeout(500);
			const afterTop = await topOfText(page, seen.text);
			const delta = Math.abs(afterTop - seen.top);
			if (delta > 40) {
				fails.push(
					`scroll jumped by ${delta}px after prepend (before: ${seen.top}, after: ${afterTop})`,
				);
			}

			// 3. "Scroll to end" button appears when scrolled away
			await scroller.evaluate((el) => el.scrollBy(0, -1500));
			const toEnd = page.getByTestId("transcript-to-end");
			if (!(await toEnd.isVisible())) {
				fails.push("Scroll to end button not visible when scrolled away");
			}

			// 4. "N new" pill appears when new messages arrive below reader
			const live = await liveStreamOnce(
				page,
				id,
				"A new incoming message arrived below reader.",
			);
			await open(threadPath);
			await expect(page.getByText("Turn 242:").first()).toBeVisible({
				timeout: 60_000,
			});
			await page
				.getByTestId("transcript-scroller")
				.evaluate((el) => el.scrollBy(0, -1500));
			await expect(page.getByTestId("transcript-to-end")).toBeVisible();

			live.release();
			const newPill = page.getByTestId("transcript-new");
			await expect(newPill).toBeVisible({ timeout: 30_000 });
			const pillText = (await newPill.textContent()) ?? "";
			if (!pillText.includes("1 new")) {
				fails.push(`new messages pill reads "${pillText}", expected "1 new"`);
			}

			return verdict(
				fails,
				`DOM bounded at ${count} rows, scroll held within ${delta}px on prepend, and "Scroll to end" and "${pillText}" pill appeared`,
			);
		},
	},
	{
		item: "12.3",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			const threadPath = sim.thread("seed: long-thread");

			// Open once to populate IndexedDB snapshot
			await open(threadPath);
			await expect(page.getByText("Turn 242:").first()).toBeVisible({
				timeout: 60_000,
			});
			// Allow time for snapshot debounce (1500ms)
			await page.waitForTimeout(2000);

			// Intercept and delay server window response to verify cached snapshot renders first
			let serverFinished = false;
			await page.route("**/api/investigations/*/window*", async (route) => {
				await page.waitForTimeout(1500);
				serverFinished = true;
				await route.continue();
			});

			await page.goto(threadPath);
			await page.waitForTimeout(400);

			// Items should be rendered from snapshot before server responds
			const itemsBefore = await rowsInDom(page);
			if (serverFinished) {
				fails.push("server responded before snapshot check completed");
			}
			if (itemsBefore === 0) {
				fails.push(
					"no rows rendered from cached snapshot before server window response arrived",
				);
			}

			// Wait for server response and reconciliation
			await expect(page.getByText("Turn 242:").first()).toBeVisible({
				timeout: 40_000,
			});
			const itemsAfter = await rowsInDom(page);
			await page.unrouteAll({ behavior: "ignoreErrors" });

			return verdict(
				fails,
				`cached snapshot rendered ${itemsBefore} rows before server responded, then reconciled to ${itemsAfter} rows`,
			);
		},
	},
	{
		item: "12.4",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			const threadPath = sim.thread("seed: long-thread");
			const id = threadPath.split("/").pop() ?? "";

			const cursors: string[] = [];
			page.on("request", (r) => {
				const u = new URL(r.url());
				if (u.pathname === `/api/investigations/${id}/stream`)
					cursors.push(u.searchParams.get("after") ?? "");
			});
			const live = await liveStreamOnce(page, id, "Resumed message gap.");
			await open(threadPath);
			await expect(page.getByText("Turn 242:").first()).toBeVisible({
				timeout: 60_000,
			});

			// Stamp window to verify no full page reload occurs
			await page.evaluate(() => {
				(window as unknown as { __pl_marker?: number }).__pl_marker = 9876;
			});

			// Releasing stream without keeping connection open simulates a dropped live connection
			live.release();

			const reconnecting = page.getByTestId("transcript-reconnecting");
			await expect(reconnecting).toBeVisible({ timeout: 30_000 });
			const reconText = (await reconnecting.textContent()) ?? "";
			if (!reconText.includes("Reconnecting")) {
				fails.push(
					`reconnecting notice "${reconText}" does not contain "Reconnecting"`,
				);
			}

			// Verify page did not reload
			const marker = await page.evaluate(
				() => (window as unknown as { __pl_marker?: number }).__pl_marker,
			);
			if (marker !== 9876) {
				fails.push(
					"page reloaded on dropped connection instead of reconnecting in place",
				);
			}

			await expect
				.poll(() => cursors.length, { timeout: 15_000 })
				.toBeGreaterThan(1);
			const parse = (c: string) =>
				/^(\d+)\.(\d+)$/.exec(c)?.slice(1).map(Number);
			const first = parse(cursors[0] ?? "");
			const last = parse(cursors[cursors.length - 1] ?? "");
			if (!first || !last) {
				fails.push(
					`stream requests carried no gen.seq cursor: [${cursors.join(", ")}]`,
				);
			} else if (last[0] !== first[0] || (last[1] ?? 0) < (first[1] ?? 0)) {
				fails.push(
					`reconnect cursor ${cursors.at(-1)} is behind the first ${cursors[0]}`,
				);
			}

			return verdict(
				fails,
				`dropped connection showed "${reconText.trim()}" without page reload, and the stream reconnected from cursor ${cursors.at(-1)} (first ${cursors[0]}, ${cursors.length} requests)`,
			);
		},
	},
	{
		item: "12.5",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			const threadPath = sim.thread("seed: long-thread");

			await open(threadPath);
			await expect(page.getByText("Turn 242:").first()).toBeVisible({
				timeout: 60_000,
			});

			// 1. A folded turn does not need its contents loaded: none was asked for until it opens
			const turnReads: string[] = [];
			page.on("request", (r) => {
				const u = new URL(r.url());
				if (u.pathname.endsWith("/window/page") && u.searchParams.has("turn"))
					turnReads.push(u.searchParams.get("turn") ?? "");
			});
			const folds = page.getByTestId("turn-fold-remote");
			const foldsBefore = await folds.count();
			if (foldsBefore === 0) {
				fails.push("no folded turn without its contents on the long thread");
			} else if (turnReads.length > 0) {
				fails.push(
					`${turnReads.length} turn contents were read before any fold opened`,
				);
			} else {
				await folds.first().click();
				await expect.poll(() => turnReads.length, { timeout: 15_000 }).toBe(1);
			}

			// 2. Failed page shows Retry in place
			await page.route("**/api/investigations/*/window/page*", (route) =>
				route.abort("failed"),
			);

			const scroller = page.getByTestId("transcript-scroller");
			await scroller.evaluate((el) => el.scrollTo(0, 0));

			const edge = page.getByTestId("transcript-edge-before");
			await expect(edge).toHaveAttribute("data-state", "error", {
				timeout: 30_000,
			});
			const edgeText = (await edge.textContent()) ?? "";
			if (!edgeText.includes("Couldn't load earlier messages")) {
				fails.push(
					`failed page edge text "${edgeText}" does not explain failure`,
				);
			}

			const retryBtn = edge.getByRole("button", { name: "Retry" });
			if (!(await retryBtn.isVisible())) {
				fails.push("failed page edge does not offer Retry button");
			} else {
				// Unroute and click Retry
				await page.unroute("**/api/investigations/*/window/page*");
				await retryBtn.click();
				await expect(retryBtn).not.toBeVisible({ timeout: 20_000 });
				await expect(
					edge.getByText("Couldn't load earlier messages"),
				).not.toBeVisible({ timeout: 20_000 });
			}

			return verdict(
				fails,
				`${foldsBefore} folded turns read nothing until one opened (1 turn read on opening one), and failed page shows "${edgeText.trim()}" with working Retry in place`,
			);
		},
	},
	{
		item: "12.6",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			const threadPath = sim.thread("seed: long-thread");
			await open(threadPath);
			await expect(page.getByText("Turn 242:").first()).toBeVisible({
				timeout: 60_000,
			});
			const viewBtn = page.getByTestId("view-level");
			await expect(viewBtn).toBeVisible({ timeout: 10_000 });

			// 1. Alt+V alone steps through three distinct levels and returns to the first
			const initial = (await viewBtn.getAttribute("data-level")) ?? "";
			const seen = [initial];
			for (let i = 0; i < 3; i++) {
				const before = seen[seen.length - 1] ?? "";
				await page.keyboard.press("Alt+v");
				await expect(viewBtn).not.toHaveAttribute("data-level", before, {
					timeout: 3000,
				});
				seen.push((await viewBtn.getAttribute("data-level")) ?? "");
			}
			const levels = new Set(seen.slice(0, 3));
			if (levels.size !== 3 || seen[3] !== initial) {
				fails.push(
					`Alt+V visited [${seen.join(" -> ")}], expected 3 levels and back`,
				);
			}

			// 2. The level is saved: it survives a reload
			await page.keyboard.press("Alt+v");
			const changed = (await viewBtn.getAttribute("data-level")) ?? "";
			await page.reload();
			await expect(page.getByTestId("view-level")).toHaveAttribute(
				"data-level",
				changed,
				{ timeout: 20_000 },
			);
			await page.keyboard.press("Alt+v");
			await page.keyboard.press("Alt+v");
			await expect(page.getByTestId("view-level")).toHaveAttribute(
				"data-level",
				initial,
			);

			// 3. Opening a fold keeps the reader's place: the row above it holds still
			await expect(page.getByText("Turn 242:").first()).toBeVisible({
				timeout: 30_000,
			});
			const fold = page.getByTestId("turn-fold-remote").first();
			await expect(fold).toBeVisible();
			const anchor = await fold.evaluate((el) => {
				const top = el.getBoundingClientRect().top;
				const rows = Array.from(
					document.querySelectorAll<HTMLElement>(
						"[data-testid=transcript] [data-at]",
					),
				).filter((r) => r.getBoundingClientRect().bottom <= top + 1);
				const row = rows[rows.length - 1];
				if (!row) return null;
				row.setAttribute("data-bar-anchor", "1");
				return row.getBoundingClientRect().top;
			});
			if (anchor === null) {
				fails.push("no transcript row sits above the first visible fold");
			} else {
				await fold.click();
				await page.waitForTimeout(1500);
				const after = await page
					.locator("[data-bar-anchor]")
					.evaluate((el) => el.getBoundingClientRect().top);
				if (Math.abs(after - anchor) > 40) {
					fails.push(
						`opening a fold moved the row above it by ${Math.round(after - anchor)}px`,
					);
				}
			}

			return verdict(
				fails,
				`Alt+V stepped ${seen.join(" -> ")}, the level ("${changed}") survived a reload, and opening a fold kept the row above it in place`,
			);
		},
	},
]);
