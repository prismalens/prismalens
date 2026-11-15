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
			if (dimmed === 0 && count > 0) {
				const unread = doneRows.first();
				const id = await unread.getAttribute("data-id");
				await unread.click();
				await expect(page).toHaveURL(/\/(threads|incidents|investigations)\//);
				await page.waitForTimeout(3000);
				await open("/new");
				const after = page.locator(
					`[data-testid="thread-row"][data-id="${id}"]`,
				);
				await expect(after).toBeVisible();
				const quiet = await expect(after)
					.toHaveAttribute("data-quiet", "true", { timeout: 10_000 })
					.then(
						() => true,
						() => false,
					);
				if (quiet) dimmed = 1;
				else fails.push("an opened Done thread did not dim");
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

			const waitingRows = tree.locator(
				'[data-testid="thread-row"][data-state="waiting"]',
			);
			const count = await waitingRows.count();

			const fails: string[] = [];
			if (count === 0) {
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
			if (rowData && rowData.status !== "working")
				return notSetUp(
					`the stalled fixture is "${rowData.status}" by now (${rowData.detail || rowData.cause}): it fails at its 15-minute limit`,
				);

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
]);
