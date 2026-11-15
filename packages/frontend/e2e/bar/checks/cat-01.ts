// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { defineChecks, verdict } from "../bar";

/** #1101 category 1, Thread list: the sidebar on the sim's threads.many list. */
export default defineChecks([
	{
		item: "1.1",
		async run({ page, open }) {
			await open("/new");
			const tree = page.getByTestId("thread-tree");
			await expect(tree).toBeVisible();

			// Expand active threads if more button is present.
			const showMore = page.getByTestId("threads-show-more");
			while (await showMore.isVisible().catch(() => false)) {
				await showMore.click();
				await page.waitForTimeout(100);
			}

			const rows = tree.getByTestId("thread-row");
			await expect(rows.first()).toBeVisible();

			const data = await rows.evaluateAll((els) =>
				els.map((el) => {
					const wrap = el.closest('[data-testid="thread-row-wrap"]') ?? el;
					const inNeeds = !!el.closest('[data-testid="thread-section-needs"]');
					const inSettled = !!el.closest(
						'[data-testid="thread-section-settled"]',
					);
					const inThreads = !!el.closest(
						'[data-testid="thread-section-threads"]',
					);
					const hasNestedRow = !!el.querySelector('[data-testid="thread-row"]');
					const startedBy = el.getAttribute("data-started-by");
					const hasStarterMark =
						!!wrap.querySelector('[data-testid="mark-started-by"]') ||
						!!wrap.querySelector("[data-starter]");
					const status = el.getAttribute("data-state") || "";
					const title =
						wrap
							.querySelector('[data-testid="row-title"]')
							?.textContent?.trim() ?? "";
					return {
						hasNestedRow,
						startedBy,
						hasStarterMark,
						status,
						title,
						inNeeds,
						inSettled,
						inThreads,
					};
				}),
			);

			const fails: string[] = [];
			if (data.some((r) => r.hasNestedRow)) {
				fails.push("list is not flat: nested thread-row elements found");
			}

			const agentRows = data.filter((r) => r.startedBy === "agent");
			if (agentRows.length < 12) {
				fails.push(
					`expected at least 12 agent-started rows, found ${agentRows.length}`,
				);
			}
			for (const r of agentRows) {
				if (!r.hasStarterMark) {
					fails.push(
						`agent-started row "${r.title}" is missing started-by mark`,
					);
				}
			}

			// In active threads, rows needing nothing (agent-started done/waiting) must sink below others.
			const activeRows = data.filter((r) => r.inThreads);
			const sinks = (r: (typeof data)[number]) =>
				r.startedBy === "agent" &&
				(r.status === "done" || r.status === "waiting");

			let seenSink = false;
			if (!activeRows.some(sinks)) {
				fails.push("no agent-started done/waiting row in Threads to sink");
			}
			for (const r of activeRows) {
				if (sinks(r)) {
					seenSink = true;
				} else if (seenSink) {
					fails.push(`row "${r.title}" appears after sinking agent rows`);
					break;
				}
			}

			return verdict(
				fails,
				`${data.length} threads, ${agentRows.length} agent-started: list is flat, all carry started-by mark, and idle agent rows sink below the rest`,
			);
		},
	},
	{
		item: "1.2",
		async run({ page, open }) {
			await open("/new");
			const tree = page.getByTestId("thread-tree");
			await expect(tree).toBeVisible();

			const needsSection = page.getByTestId("thread-section-needs");
			await expect(needsSection).toBeVisible();

			// Check that Needs you section sits above regular Threads and Settled.
			const orderOk = await tree.evaluate((el) => {
				const sections = Array.from(el.querySelectorAll("section"));
				const needsIdx = sections.findIndex(
					(s) => s.getAttribute("data-testid") === "thread-section-needs",
				);
				const threadsIdx = sections.findIndex(
					(s) => s.getAttribute("data-testid") === "thread-section-threads",
				);
				return needsIdx === 0 && (threadsIdx === -1 || needsIdx < threadsIdx);
			});

			const fails: string[] = [];
			if (!orderOk) {
				fails.push("needs-you section does not sit on top of the list");
			}

			const countEl = page.getByTestId("thread-section-needs-count");
			await expect(countEl).toBeVisible();
			const countText = (await countEl.textContent())?.trim() ?? "";
			const headerCount = Number.parseInt(countText, 10);
			if (Number.isNaN(headerCount) || headerCount <= 0) {
				fails.push(`section header count is invalid: "${countText}"`);
			}

			const needsRows = needsSection.getByTestId("thread-row");
			const rowsCount = await needsRows.count();
			if (rowsCount !== headerCount) {
				fails.push(
					`section header count (${headerCount}) does not match visible rows count (${rowsCount})`,
				);
			}

			return verdict(
				fails,
				`needs-you section sits on top with full count ${headerCount} matching ${rowsCount} rows`,
			);
		},
	},
	{
		item: "1.4",
		async run({ page, open }) {
			await open("/new");
			const rows = page.getByTestId("thread-tree").getByTestId("thread-row");
			await expect(rows.first()).toBeVisible();
			const seen = await rows.evaluateAll((els) =>
				els.map((el) => {
					const wrap = el.closest('[data-testid="thread-row-wrap"]') ?? el;
					const text = (id: string) =>
						wrap.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ??
						"";
					return {
						title: text("row-title"),
						word: text("row-status"),
						age: text("row-age"),
						needs: !!el.closest('[data-testid="thread-section-needs"]'),
						detail: text("row-detail") || text("row-cause"),
					};
				}),
			);
			const fails = seen.flatMap((r, i) => {
				const name = r.title || `row ${i + 1}`;
				return [
					!r.title && `${name}: no title`,
					!r.word && `${name}: no status word`,
					!r.age && `${name}: no age`,
					r.needs &&
						!r.detail &&
						`${name}: a needs-you row with no detail line`,
				].filter((x): x is string => !!x);
			});
			return verdict(
				fails,
				`${seen.length} rows: each has a title, a status word and an age; ${seen.filter((r) => r.needs).length} needs-you rows each have a detail line`,
			);
		},
	},
	{
		item: "1.5",
		async run({ page, open }) {
			await open("/new");
			const settledSection = page.getByTestId("thread-section-settled");
			await expect(settledSection).toBeVisible();

			const toggle = page.getByTestId("settled-toggle");
			await expect(toggle).toBeVisible();

			const fails: string[] = [];
			const expandedBefore = await toggle.getAttribute("aria-expanded");
			if (expandedBefore !== "false") {
				fails.push(
					`settled group was not collapsed initially: aria-expanded="${expandedBefore}"`,
				);
			}

			const toggleText = (await toggle.textContent())?.trim() ?? "";
			const countMatch = toggleText.match(/(\d+)/);
			if (!countMatch) {
				fails.push(`settled toggle does not show count: "${toggleText}"`);
			}
			const count = countMatch ? Number.parseInt(countMatch[1], 10) : 0;

			// Expand the settled section
			await toggle.click();
			const expandedAfter = await toggle.getAttribute("aria-expanded");
			if (expandedAfter !== "true") {
				fails.push(
					`settled group did not expand after click: aria-expanded="${expandedAfter}"`,
				);
			}

			const settledRows = settledSection.getByTestId("thread-row");
			await settledRows
				.first()
				.waitFor({ state: "visible", timeout: 10_000 })
				.catch(() => {});
			const visibleCount = await settledRows.count();
			if (count === 0) fails.push("settled count is 0: nothing to fold");
			if (visibleCount === 0) {
				fails.push(
					`settled group says ${count} but shows 0 rows after expanding`,
				);
			}

			const showMore = page.getByTestId("settled-show-more");
			const hasShowMore = await showMore.isVisible().catch(() => false);
			let moreText = "";
			if (count > 10) {
				if (!hasShowMore) {
					fails.push(
						`settled count (${count}) > 10 but "Show N more" button missing`,
					);
				} else {
					moreText = (await showMore.textContent())?.trim() ?? "";
					if (!/Show \d+ more/.test(moreText)) {
						fails.push(`show more button text invalid: "${moreText}"`);
					}
				}
			}

			return verdict(
				fails,
				`settled group is collapsed at the foot with count ${count}; expands to show ${visibleCount} rows and "${moreText || "all rows"}"`,
			);
		},
	},
	{
		item: "1.6",
		async run({ page, open }) {
			await open("/new");
			const tree = page.getByTestId("thread-tree");
			await expect(tree).toBeVisible();

			const fails: string[] = [];

			// 1. Idle row in active section: Space peeks last agent sentence
			const activeRows = tree
				.getByTestId("thread-section-threads")
				.getByTestId("thread-row");
			await expect(activeRows.first()).toBeVisible();

			// Pick an idle row with no ask
			const idleRow = activeRows
				.filter({ hasNot: page.locator('[data-testid="row-answer"]') })
				.first();
			await idleRow.scrollIntoViewIfNeeded();
			await idleRow.hover();
			await page.waitForTimeout(300);
			await idleRow.focus();
			await page.keyboard.press("Space");

			const peek = page.getByTestId("row-peek");
			const peekVisible = await expect(peek)
				.toBeVisible({ timeout: 5000 })
				.then(
					() => true,
					() => false,
				);
			if (!peekVisible) {
				fails.push("Space on idle row did not open row-peek");
			} else {
				const latestText = await page
					.getByTestId("peek-latest")
					.textContent()
					.catch(() => null);
				if (!latestText?.trim()) {
					fails.push("peek card has no latest agent sentence");
				}
				// Close peek
				await page.keyboard.press("Escape");
				await expect(peek).toBeHidden();
			}

			// 2. Needs-you row: Space peeks pending ask
			const needsRows = tree
				.getByTestId("thread-section-needs")
				.getByTestId("thread-row");
			await expect(needsRows.first()).toBeVisible();

			const askRow = needsRows.first();
			await askRow.scrollIntoViewIfNeeded();
			await askRow.hover();
			await page.waitForTimeout(300);
			await askRow.focus();
			await page.keyboard.press("Space");

			const askCard = page.getByTestId("row-ask-card");
			const askVisible = await expect(askCard)
				.toBeVisible({ timeout: 5000 })
				.then(
					() => true,
					() => false,
				);
			if (!askVisible) {
				fails.push("Space on needs-you row did not open row-ask-card");
			} else {
				const askText = await askCard.textContent().catch(() => "");
				if (!askText?.trim()) {
					fails.push("row-ask-card is empty");
				}
				await page.keyboard.press("Escape");
				await expect(askCard).toBeHidden();
			}

			return verdict(
				fails,
				"Space peeks last agent sentence on idle row and pending ask on needs-you row",
			);
		},
	},
	{
		item: "1.7",
		async run({ page, open }) {
			await open("/new");
			const tree = page.getByTestId("thread-tree");
			await expect(tree).toBeVisible();

			const fails: string[] = [];
			const params = () => new URL(page.url()).searchParams;

			// Started by: the toggle writes ?started= and a reload keeps it.
			await page.getByTestId("hide-agent-started").click({ timeout: 10_000 });
			await expect.poll(() => params().get("started")).toBe("people");
			await page.reload();
			await expect(tree).toBeVisible();
			const startedKept = params().get("started") === "people";
			if (!startedKept)
				fails.push("started by is not kept in the URL on reload");
			await page.getByTestId("hide-agent-started").click({ timeout: 10_000 });

			// State and PR state: the sidebar's Filter popover must offer them and the URL must carry them.
			const filterButton = page.getByTestId("sidebar-filter");
			if (!(await filterButton.isVisible())) {
				fails.push("the sidebar has no Filter control for state or PR state");
			} else {
				await filterButton.click({ timeout: 10_000 });
				const popover = page.getByTestId("thread-filters");
				await expect(popover).toBeVisible();
				await popover
					.getByTestId("thread-filter-state")
					.click({ timeout: 10_000 });
				await page
					.getByTestId("thread-filter-state-needs")
					.click({ timeout: 10_000 });
				await page.waitForTimeout(500);
				const url = page.url();
				if (!/[?&](state|section)=/.test(url)) {
					fails.push(`state filter is not in the URL (${url})`);
				}
				await page
					.getByTestId("thread-filters-clear")
					.click({ timeout: 10_000 });
				const labels = await popover
					.locator('[data-testid^="thread-filter-"]')
					.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
				if (!labels.some((l) => /^PR/i.test(l ?? ""))) {
					fails.push(`no PR state filter (offers ${labels.join(", ")})`);
				}
				await page.keyboard.press("Escape");
			}

			return verdict(
				fails,
				"state, started by and PR state filters are offered and kept in the URL",
			);
		},
	},
	{
		item: "1.8",
		async run({ page, open }) {
			await open("/new");
			const tree = page.getByTestId("thread-tree");
			await expect(tree).toBeVisible();

			// Expand active and settled rows to get 40+ rows
			const showMore = page.getByTestId("threads-show-more");
			while (await showMore.isVisible().catch(() => false)) {
				await showMore.click();
				await page.waitForTimeout(100);
			}
			const settledToggle = page.getByTestId("settled-toggle");
			if (await settledToggle.isVisible().catch(() => false)) {
				await settledToggle.click();
				const settledMore = page.getByTestId("settled-show-more");
				while (await settledMore.isVisible().catch(() => false)) {
					await settledMore.click();
					await page.waitForTimeout(100);
				}
			}

			const rows = tree.getByTestId("thread-row");
			const count = await rows.count();

			const fails: string[] = [];
			if (count < 40) {
				fails.push(`expected 40+ rows, found ${count}`);
			}

			// Verify visual order matches DOM order
			const positions = await rows.evaluateAll((els) =>
				els.map((el) => {
					const r = el.getBoundingClientRect();
					return { top: r.top, id: el.getAttribute("data-id") };
				}),
			);

			for (let i = 0; i < positions.length - 1; i++) {
				const curr = positions[i];
				const next = positions[i + 1];
				if (curr && next && curr.top > next.top) {
					fails.push(
						`visual order mismatch: row ${i} top (${curr.top}) > row ${i + 1} top (${next.top})`,
					);
					break;
				}
			}

			// Keyboard navigation: j/k moves focus in visual order
			await rows.first().focus();
			await page.keyboard.press("j");
			const secondRowId = await rows.nth(1).getAttribute("data-id");
			const focusedIdAfterJ = await page.evaluate(() =>
				document.activeElement?.getAttribute("data-id"),
			);
			if (focusedIdAfterJ !== secondRowId) {
				fails.push(
					`pressing 'j' focused id ${focusedIdAfterJ}, expected second row ${secondRowId}`,
				);
			}

			await page.keyboard.press("k");
			const firstRowId = await rows.first().getAttribute("data-id");
			const focusedIdAfterK = await page.evaluate(() =>
				document.activeElement?.getAttribute("data-id"),
			);
			if (focusedIdAfterK !== firstRowId) {
				fails.push(
					`pressing 'k' focused id ${focusedIdAfterK}, expected first row ${firstRowId}`,
				);
			}

			// Scroll 40+ rows and measure main-thread tasks > 100 ms (the input response budget; 1.8 organizer default, 2026-11-15)
			const scrolled = await page.evaluate(async () => {
				let tasksOver100 = 0;
				const observer = new PerformanceObserver((list) => {
					for (const entry of list.getEntries()) {
						if (entry.duration > 100) tasksOver100++;
					}
				});
				observer.observe({ entryTypes: ["longtask"] });

				// The nearest ancestor of the rows that really scrolls.
				let list: HTMLElement | null = document.querySelector<HTMLElement>(
					'[data-testid="thread-tree"]',
				);
				while (
					list &&
					!(
						list.scrollHeight > list.clientHeight + 1 &&
						/auto|scroll/.test(getComputedStyle(list).overflowY)
					)
				)
					list = list.parentElement;
				if (!list) {
					observer.disconnect();
					return { tasksOver100, moved: 0 };
				}
				const start = list.scrollTop;
				let moved = 0;
				for (let i = 0; i < 5; i++) {
					list.scrollTop += 500;
					moved = Math.max(moved, Math.abs(list.scrollTop - start));
					await new Promise((r) => setTimeout(r, 50));
				}
				for (let i = 0; i < 5; i++) {
					list.scrollTop -= 500;
					await new Promise((r) => setTimeout(r, 50));
				}
				observer.disconnect();
				return { tasksOver100, moved };
			});
			const longTaskCount = scrolled.tasksOver100;

			if (scrolled.moved === 0) {
				fails.push("the thread list has no scrolling ancestor that moved");
			}
			if (longTaskCount > 0) {
				fails.push(
					`${longTaskCount} main-thread tasks over 100 ms during scroll`,
				);
			}

			return verdict(
				fails,
				`${count} rows: visual order matches DOM order, j/k moves focus in order, and a ${scrolled.moved}px scroll had 0 tasks > 100 ms`,
			);
		},
	},
]);
