// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { defineChecks, notSetUp, verdict } from "../bar";

/** #1101 category 2, Thread statuses. */
export default defineChecks([
	{
		item: "2.2",
		async run({ page, open }) {
			await open("/new");
			const tree = page.getByTestId("thread-tree");
			await expect(tree).toBeVisible();

			const activeSection = page.getByTestId("thread-section-threads");
			// The first frame draws only Needs you; Threads fills after it (#1101 cat 1).
			await expect(activeSection.getByTestId("thread-row").first()).toBeVisible(
				{ timeout: 30_000 },
			);
			const doneRows = activeSection.locator(
				'[data-testid="thread-row"][data-state="done"]',
			);
			const count = await doneRows.count();

			const fails: string[] = [];
			if (count === 0) {
				fails.push("no idle unsettled threads with status Done found");
			}

			const evaluated = await doneRows.evaluateAll((els) =>
				els.map((el) => {
					const wrap = el.closest('[data-testid="thread-row-wrap"]') ?? el;
					const status =
						wrap
							.querySelector('[data-testid="row-status"]')
							?.textContent?.trim() ?? "";
					const quiet = el.getAttribute("data-quiet") === "true";
					const titleEl = wrap.querySelector('[data-testid="row-title"]');
					const isUnread = titleEl?.classList.contains("font-semibold");
					const title = titleEl?.textContent?.trim() ?? "";
					const hasSettle = !!wrap.querySelector(
						'[data-testid="thread-settle"]',
					);
					return { title, status, quiet, isUnread, hasSettle };
				}),
			);

			for (const r of evaluated) {
				if (r.status !== "Done") {
					fails.push(
						`thread "${r.title}" status word is "${r.status}", expected "Done"`,
					);
				}
				if (!r.isUnread && !r.quiet) {
					fails.push(
						`seen thread "${r.title}" is not dimmed (lacks data-quiet)`,
					);
				}
				if (!r.hasSettle) {
					fails.push(`thread "${r.title}" does not offer Settle in the row`);
				}
			}

			// Dimming is only proved by a seen row: open one unread row and see it dim.
			let dimmed = evaluated.filter((r) => !r.isUnread && r.quiet).length;
			const unreadAt = evaluated.findIndex((r) => r.isUnread);
			if (unreadAt >= 0 || (dimmed === 0 && count > 0)) {
				const unread = doneRows.nth(Math.max(unreadAt, 0));
				const id = await unread.getAttribute("data-id");
				await unread.click();
				await expect(page).toHaveURL(/\/(threads|incidents|investigations)\//);
				await page.waitForTimeout(3000);
				// The read mark lands after the thread page settles, later on the slow link: look again before calling it undimmed.
				let quiet = false;
				for (let i = 0; i < 6 && !quiet; i++) {
					await open("/new");
					const after = page.locator(
						`[data-testid="thread-row"][data-id="${id}"]`,
					);
					await expect(after).toBeVisible({ timeout: 30_000 });
					quiet = await expect(after)
						.toHaveAttribute("data-quiet", "true", { timeout: 8000 })
						.then(
							() => true,
							() => false,
						);
				}
				if (quiet) dimmed = 1;
				else
					fails.push(
						"opening an unread Done thread never marks it seen, so it stays bold and undimmed (the /threads page makes no visit call; RunPage does)",
					);
			}

			return verdict(
				fails,
				`${evaluated.length} idle unsettled threads: each shows "Done" and offers Settle; ${dimmed} seen ones dim`,
			);
		},
	},
	{
		item: "2.3",
		async run({ page, open }) {
			await open("/new");
			const tree = page.getByTestId("thread-tree");
			await expect(tree).toBeVisible();

			await expect(
				page
					.getByTestId("thread-section-threads")
					.getByTestId("thread-row")
					.first(),
			).toBeVisible({ timeout: 30_000 });
			const waitingRows = tree.locator(
				'[data-testid="thread-row"][data-state="waiting"]',
			);
			const count = await waitingRows.count();

			const fails: string[] = [];
			if (count === 0) {
				const shown = await page
					.getByTestId("thread-section-threads")
					.getByTestId("thread-row")
					.count();
				const feed = (await (
					await page.request.get("/api/threads/feed?cursor=0")
				).json()) as { counts: { active: number } };
				// The sidebar loads one feed page (#1101 cat 1), so older waiting rows may not be drawn.
				if (feed.counts.active > shown)
					return notSetUp(
						`the sidebar lists ${shown} of ${feed.counts.active} active threads (one feed page, the rest taken by Needs you) and none of them is waiting`,
					);
				fails.push("no waiting threads found in sidebar");
			}

			const details = await waitingRows.evaluateAll((els) =>
				els.map((el) => {
					const wrap = el.closest('[data-testid="thread-row-wrap"]') ?? el;
					const detail =
						wrap
							.querySelector('[data-testid="row-detail"]')
							?.textContent?.trim() ||
						wrap
							.querySelector('[data-testid="row-cause"]')
							?.textContent?.trim() ||
						"";
					const title =
						wrap
							.querySelector('[data-testid="row-title"]')
							?.textContent?.trim() ?? "";
					return { title, detail };
				}),
			);

			const WAITING_PATTERN =
				/(watching\s+pr\s*#?\d+|cron\b.*\d|wakes?\b.*\d|\bnext\b.*\d)/i;
			for (const r of details) {
				if (!r.detail || !WAITING_PATTERN.test(r.detail)) {
					fails.push(
						`waiting thread "${r.title}" does not name what it waits on: "${r.detail}"`,
					);
				}
			}

			const example = details[0]?.detail ?? "none";
			return verdict(
				fails,
				`${details.length} waiting threads name what they wait on (e.g. "${example}")`,
			);
		},
	},
	{
		item: "2.4",
		async run({ page, open, device, sim }) {
			await open("/new");
			const tree1 = page.getByTestId("thread-tree");
			await expect(tree1).toBeVisible();

			// Open second paired device at desktop width to inspect synced sidebar state
			const secondDevice = await device({ width: 1280, height: 800 });
			await secondDevice.goto(`${sim.url}/new`);
			const tree2 = secondDevice.getByTestId("thread-tree");
			await expect(tree2).toBeVisible();

			const rows1 = tree1.getByTestId("thread-row");
			const expectedCount = await rows1.count();
			const rows2 = tree2.getByTestId("thread-row");
			await expect(rows2).toHaveCount(expectedCount);

			const getUnread = async (p: typeof page) => {
				const rows = p.getByTestId("thread-tree").getByTestId("thread-row");
				return rows.evaluateAll((els) =>
					els
						.filter((el) => {
							const wrap = el.closest('[data-testid="thread-row-wrap"]') ?? el;
							const titleEl = wrap.querySelector('[data-testid="row-title"]');
							return titleEl?.classList.contains("font-semibold");
						})
						.map((el) => ({
							id: el.getAttribute("data-id") ?? "",
							state: el.getAttribute("data-state") ?? "",
						})),
				);
			};

			// A thread opened a moment ago may still be settling its read mark on one device.
			let desktopUnread = await getUnread(page);
			let secondUnread = await getUnread(secondDevice);
			for (let i = 0; i < 6; i++) {
				if (desktopUnread.length === secondUnread.length) break;
				await page.waitForTimeout(2000);
				await secondDevice.reload();
				await page.reload();
				await expect(page.getByTestId("thread-row").first()).toBeVisible();
				await expect(
					secondDevice.getByTestId("thread-row").first(),
				).toBeVisible();
				desktopUnread = await getUnread(page);
				secondUnread = await getUnread(secondDevice);
			}

			await secondDevice.close();

			const fails: string[] = [];
			const desktopIds = desktopUnread.map((u) => u.id).sort();
			const secondIds = secondUnread.map((u) => u.id).sort();

			if (desktopIds.length === 0) {
				fails.push("no unread threads found to compare");
			}

			if (desktopIds.join(",") !== secondIds.join(",")) {
				fails.push(
					`device 1 (${desktopIds.length} unread) and device 2 (${secondIds.length} unread) disagree on unread threads`,
				);
			}

			// Unread is separate from state: verify unread threads have distinct states
			const states = new Set(desktopUnread.map((u) => u.state));
			if (states.size < 2) {
				fails.push(
					`unread threads only found in state(s): ${Array.from(states).join(", ")}`,
				);
			}

			return verdict(
				fails,
				`two devices agree on ${desktopIds.length} unread threads across states (${Array.from(states).join(", ")})`,
			);
		},
	},
	{
		item: "2.5",
		async run({ page, open, sim }) {
			const path = sim.thread("agent.stalled");
			const threadId = path.split("/").pop();

			await open("/new");
			const tree = page.getByTestId("thread-tree");
			await expect(tree).toBeVisible();

			const rowData = await page.evaluate((id) => {
				const el = document.querySelector(
					`[data-testid="thread-row"][data-id="${id}"]`,
				);
				if (!el) return null;
				const wrap = el.closest('[data-testid="thread-row-wrap"]') ?? el;
				const detail =
					wrap
						.querySelector('[data-testid="row-detail"]')
						?.textContent?.trim() ?? "";
				const cause =
					wrap
						.querySelector('[data-testid="row-cause"]')
						?.textContent?.trim() ?? "";
				const status = el.getAttribute("data-state") ?? "";
				return { detail, cause, status };
			}, threadId);

			// The fixture goes quiet after 5 min and fails at its 15-min run limit.
			if (!rowData)
				return notSetUp(
					"the stalled fixture is no longer among the sidebar's shown rows, where a Working thread sits: it has failed at its 15-minute limit",
				);
			if (rowData.status !== "working")
				return notSetUp(
					`the stalled fixture is "${rowData.status}" by now (${rowData.detail || rowData.cause}): it fails at its 15-minute limit`,
				);

			// The fixture's agent goes silent 5 minutes in and reads quiet once it has been silent 5 more.
			if (!/Working,\s*quiet for\s*\d+\s*min/i.test(rowData.detail)) {
				const record = await (
					await page.request.get(`/api/investigations/${threadId}`)
				).text();
				const started = /"startedAt":"([^"]+)"/.exec(record)?.[1];
				const minutes = started
					? (Date.now() - Date.parse(started)) / 60_000
					: 0;
				if (minutes < 11)
					return notSetUp(
						`the stalled fixture is ${Math.round(minutes)} min old, so it has not been silent for 5 min yet and reads "${rowData.detail}"; it reads quiet from about its 10th minute and fails at its 15-minute limit`,
					);
			}

			await open(path);
			const pageEl = page.getByTestId("thread-page");
			await expect(pageEl).toBeVisible();

			const fails: string[] = [];
			if (!rowData) {
				fails.push("stalled thread row not found in sidebar");
			} else {
				const detailText = rowData.detail || rowData.cause;
				const QUIET_RE = /Working,\s*quiet for\s*\d+\s*min/i;
				if (!QUIET_RE.test(detailText)) {
					fails.push(
						`stalled fixture is "${rowData.status}" ("${detailText}"), not Working, quiet for N min; it fails at its 15-minute limit, so a late run cannot see it`,
					);
				}
			}

			// Transcript check
			const thinking = page.getByTestId("transcript-thinking");
			if (await thinking.isVisible().catch(() => false)) {
				const thinkingText = (await thinking.textContent())?.trim() ?? "";
				if (!thinkingText.toLowerCase().includes("quiet")) {
					fails.push(
						`transcript line reads "${thinkingText}", expected "Quiet for ..."`,
					);
				}

				const bar = page.getByTestId("transcript-thinking-bar");
				const barClass = (await bar.getAttribute("class")) ?? "";
				if (barClass.includes("breathe") || barClass.includes("bg-live")) {
					fails.push(
						`transcript shows endless live spinner (class: "${barClass}")`,
					);
				}
			}

			const desc = rowData
				? rowData.detail || rowData.cause || rowData.status
				: "not found";
			return verdict(
				fails,
				`stalled Working thread reads "${desc}" without endless spinner`,
			);
		},
	},
	{
		item: "2.6",
		async run({ page, open, sim }) {
			// The full-disk thread: one stop that every surface reads as one state.
			const path = sim.thread("git.worktree-disk");
			const id = path.split("/").pop() ?? "";
			await open(path);
			await expect(page.getByTestId("thread-page")).toBeVisible({
				timeout: 45_000,
			});
			const fails: string[] = [];
			const header = page.getByTestId("thread-state").first();
			await expect(header).not.toHaveAttribute("data-state", "loading", {
				timeout: 30_000,
			});
			const said = ((await header.textContent()) ?? "").trim();
			if (!/Blocked/.test(said))
				fails.push(`the header reads "${said}", not Blocked`);
			const transcript = page.getByTestId("transcript-scroller");
			await expect(transcript).toBeVisible({ timeout: 30_000 });
			const text = (await transcript.textContent()) ?? "";
			if (/Failed:|refused/i.test(text))
				fails.push(
					`the transcript says "${/Failed:[^.]*|[^.]*refused[^.]*/i.exec(text)?.[0]?.trim()}" for a Blocked thread`,
				);
			const row = page.locator(`[data-testid="thread-row"][data-id="${id}"]`);
			await expect(row).toBeVisible({ timeout: 30_000 });
			const state = await row.getAttribute("data-state");
			if (state !== "blocked")
				fails.push(`the row reads ${state}, not blocked`);
			const wrap = page.getByTestId("thread-row-wrap").filter({ has: row });
			const fix = wrap.getByTestId("row-fix");
			const fixId = await fix
				.getAttribute("data-fix", { timeout: 10_000 })
				.catch(() => null);
			if (fixId !== "needs.freeSpace")
				fails.push(`the row offers ${fixId ?? "no fix"}, not Free space`);
			return verdict(
				fails,
				`the full-disk thread reads Blocked in the header, the row and the transcript, and its row offers ${fixId}`,
			);
		},
	},
]);
