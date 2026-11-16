// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { defineChecks, verdict } from "../bar";

/** #1101 category 13, Transcript find (Ctrl+F). */
export default defineChecks([
	{
		item: "13.1",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			await open(sim.thread("usage.telemetry"));
			await expect(page.getByTestId("thread-page")).toBeVisible();

			// 1. Ctrl+F opens find bar
			await page.keyboard.press("Control+f");
			const findBar = page.getByTestId("find-bar");
			await expect(findBar).toBeVisible({ timeout: 10_000 });

			// 2. Type query and second press selects query
			const input = page.getByTestId("find-input");
			const where = await page.evaluate(() => {
				const b = document
					.querySelector("[data-testid=find-bar]")
					?.getBoundingClientRect();
				const box = document
					.querySelector("[data-testid=transcript-scroller]")
					?.getBoundingClientRect();
				if (!b || !box) return null;
				return {
					rightGap: Math.round(box.right - b.right),
					topGap: Math.round(b.top - box.top),
				};
			});
			if (!where || where.rightGap > 80 || where.topGap > 80) {
				fails.push(
					`find bar is not at the transcript's top right (gap right ${where?.rightGap}px, top ${where?.topGap}px)`,
				);
			}
			await input.fill("deploy");
			await page.keyboard.press("Control+f");
			await expect(input).toBeFocused();

			const sel = await input.evaluate((el: HTMLInputElement) => ({
				start: el.selectionStart,
				end: el.selectionEnd,
				len: el.value.length,
			}));
			if (sel.start !== 0 || sel.end !== sel.len || sel.len !== 6) {
				fails.push(
					`second Ctrl+F selection was [${sel.start}, ${sel.end}] for length ${sel.len}, expected full selection`,
				);
			}

			// 3. Escape closes find bar and returns focus to composer
			await page.keyboard.press("Escape");
			await expect(findBar).toHaveCount(0);

			const composer = page.getByTestId("composer-input");
			await expect(composer).toBeFocused({ timeout: 5000 });

			return verdict(
				fails,
				`Ctrl+F opened the find bar at the transcript top right (gaps ${where?.rightGap}px right, ${where?.topGap}px top), second Ctrl+F selected 6/6 characters, and Escape closed find bar returning focus to composer`,
			);
		},
	},
	{
		item: "13.2",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			await open(sim.thread("seed: long-thread"));
			await expect(page.getByText("Turn 242:").first()).toBeVisible({
				timeout: 60_000,
			});

			await page.keyboard.press("Control+f");
			const input = page.getByTestId("find-input");
			const count = page.getByTestId("find-count");
			await expect(input).toBeVisible();

			// A slow count says it is counting
			await page.route("**/api/investigations/*/search*", async (route) => {
				await new Promise((r) => setTimeout(r, 2500));
				await route.continue().catch(() => undefined);
			});
			await input.fill("Turn 7");
			await expect(count).toHaveText("Counting…", { timeout: 5000 });
			await expect(count).toHaveText(/^[0-9]+\/[0-9]+$/, { timeout: 30_000 });
			await page.unrouteAll({ behavior: "ignoreErrors" });

			// Match query across whole 5,000-item thread
			await input.fill("Turn ");
			await expect(count).toHaveText(/\d+\/\d+/, { timeout: 30_000 });
			const matchText = (await count.textContent()) ?? "";
			const total = Number.parseInt(matchText.split("/")[1] ?? "0", 10);
			if (total < 50) {
				fails.push(
					`count "${matchText}" does not cover whole 5,000-item thread (expected >50 turns)`,
				);
			}

			// No match shows 0/0
			await input.fill("zzz_nonexistent_token_99999");
			await expect(count).toHaveText("0/0", { timeout: 20_000 });

			return verdict(
				fails,
				`find count said "Counting…" while the search was slow, covers the whole thread ("${matchText}") and displays "0/0" when nothing matches`,
			);
		},
	},
	{
		item: "13.3",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			await open(sim.thread("seed: long-thread"));
			await expect(page.getByText("Turn 242:").first()).toBeVisible({
				timeout: 60_000,
			});

			await page.keyboard.press("Control+f");
			const input = page.getByTestId("find-input");
			const count = page.getByTestId("find-count");
			await input.fill("Turn 5:");
			await expect(count).toHaveText("1/1", { timeout: 30_000 });

			// Check scrolling into view
			await expect(
				page.locator('[data-testid="transcript"]').getByText("Turn 5:").first(),
			).toBeInViewport({
				timeout: 30_000,
			});

			// Check CSS Custom Highlight API
			const hl = await page.evaluate(() => {
				type Painted = Iterable<Range> & { size: number; priority?: number };
				const css = window.CSS as unknown as {
					highlights?: { get: (name: string) => Painted | undefined };
				};
				const all = css.highlights?.get("pl-find");
				const active = css.highlights?.get("pl-find-active");
				return {
					hits: all ? all.size : 0,
					activeText: active ? Array.from(active).map((r) => r.toString()) : [],
					priority: active ? active.priority : null,
				};
			});

			if (hl.hits === 0)
				fails.push("no ranges painted under CSS highlight 'pl-find'");
			if (hl.activeText.length !== 1 || hl.activeText[0] !== "Turn 5:")
				fails.push(
					`active highlight covers [${hl.activeText.join("|")}], expected one "Turn 5:"`,
				);
			if (hl.priority !== 1)
				fails.push(`active hit priority is ${hl.priority}, expected 1`);

			// Test navigation keys
			await input.fill("Turn ");
			await expect(count).toHaveText(/\d+\/\d+/, { timeout: 30_000 });

			// Enter moves to next
			const count1 = (await count.textContent()) ?? "";
			await input.press("Enter");
			const count2 = (await count.textContent()) ?? "";
			if (count1 === count2)
				fails.push(
					`Enter did not change active hit count (stayed "${count1}")`,
				);

			// F3 moves to next
			await input.press("F3");
			const count3 = (await count.textContent()) ?? "";
			if (count3 === count2)
				fails.push(`F3 did not change active hit count (stayed "${count2}")`);

			// Shift+F3 moves to previous
			await input.press("Shift+F3");
			const count4 = (await count.textContent()) ?? "";
			if (count4 !== count2)
				fails.push(
					`Shift+F3 did not return to previous hit (got "${count4}", expected "${count2}")`,
				);

			// Chevrons move too
			await page.getByRole("button", { name: "Next match" }).click();
			const count5 = (await count.textContent()) ?? "";
			if (count5 === count4)
				fails.push(`Next chevron did not move (stayed "${count4}")`);
			await page.getByRole("button", { name: "Previous match" }).click();
			const count6 = (await count.textContent()) ?? "";
			if (count6 !== count4)
				fails.push(`Previous chevron gave "${count6}", expected "${count4}"`);

			return verdict(
				fails,
				`Enter ${count1}->${count2}, F3 ->${count3}, Shift+F3 ->${count4}, chevrons ->${count5} and back ->${count6}; "Turn 5:" scrolled into view, ${hl.hits} ranges painted and the active one "${hl.activeText[0]}" has priority ${hl.priority}`,
			);
		},
	},
	{
		item: "13.4",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			const threadPath = sim.thread("seed: long-thread");
			const id = threadPath.split("/").pop() ?? "";

			const wholeHistory: string[] = [];
			page.on("request", (r) => {
				const u = new URL(r.url());
				if (u.pathname === `/api/investigations/${id}/events`)
					wholeHistory.push(u.search);
			});

			await open(threadPath);
			await expect(page.getByText("Turn 242:").first()).toBeVisible({
				timeout: 60_000,
			});

			await page.keyboard.press("Control+f");
			const input = page.getByTestId("find-input");
			const count = page.getByTestId("find-count");

			// Search on 5,000-item thread with no full download
			await input.fill("Turn 10:");
			await expect(count).toHaveText("1/1", { timeout: 30_000 });
			if (wholeHistory.length > 0) {
				fails.push(
					`downloaded full history (${wholeHistory.length} requests) during find on windowed thread`,
				);
			}

			// Failed search shows Retry
			await page.route("**/api/investigations/*/search*", (route) =>
				route.abort("failed"),
			);
			await input.fill("trigger_failure_query");

			const retryBtn = page.getByTestId("find-retry");
			await expect(retryBtn).toBeVisible({ timeout: 15_000 });
			const retryText = (await retryBtn.textContent()) ?? "";
			if (!retryText.includes("Retry")) {
				fails.push(`retry button text "${retryText}" does not contain "Retry"`);
			}

			await page.unroute("**/api/investigations/*/search*");
			await retryBtn.click();
			await expect(retryBtn).toHaveCount(0, { timeout: 15_000 });

			return verdict(
				fails,
				`search on 5,000-item thread ran with 0 full downloads, and aborted search showed "${retryText.trim()}" in place`,
			);
		},
	},
	{
		item: "13.5",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			const threadPath = sim.thread("seed: long-thread");

			await open(threadPath);
			await expect(page.getByText("Turn 242:").first()).toBeVisible({
				timeout: 60_000,
			});

			await page.keyboard.press("Control+f");
			await expect(page.getByTestId("find-bar")).toBeVisible();

			// 1. Scope chips
			const scopes = ["all", "mine", "agent", "tools"] as const;
			for (const s of scopes) {
				const chip = page.getByTestId(`find-scope-${s}`);
				if (!(await chip.isVisible())) {
					fails.push(`scope chip for "${s}" is not visible`);
				} else {
					await chip.click();
					const pressed = await chip.getAttribute("aria-pressed");
					if (pressed !== "true") {
						fails.push(
							`scope chip for "${s}" has aria-pressed="${pressed}", expected "true"`,
						);
					}
				}
			}

			// 2. Case toggle
			const caseBtn = page.getByTestId("find-case");
			if (!(await caseBtn.isVisible())) {
				fails.push("match case toggle button is not visible");
			} else {
				await caseBtn.click();
				const pressed = await caseBtn.getAttribute("aria-pressed");
				if (pressed !== "true") {
					fails.push(
						`match case toggle has aria-pressed="${pressed}", expected "true"`,
					);
				}
			}

			// 3. The palette finds message text across threads and opens the thread with find at the hit
			await open("/new");
			await page.keyboard.press("Control+k");
			await page.getByTestId("palette-tab-messages").click();
			await page.getByTestId("thread-search-input").fill("Turn 5:");
			const hit = page.getByTestId("thread-search-message").first();
			await expect(hit).toBeVisible({ timeout: 15_000 });
			await hit.click();
			await expect(page.getByTestId("find-bar")).toBeVisible({
				timeout: 30_000,
			});
			const val = await page.getByTestId("find-input").inputValue();
			const url = new URL(page.url());
			if (!url.searchParams.get("find") || !val.includes("Turn 5")) {
				fails.push(
					`palette hit opened ${url.pathname}${url.search}${url.hash} with find input "${val}"`,
				);
			}

			return verdict(
				fails,
				`4 scope chips (All, Mine, Agent, Tools) and case toggle verified, and a palette message hit opened ${url.pathname} with find for "${val}"`,
			);
		},
	},
	{
		item: "13.6",
		async run({ device, sim, shot }) {
			const fails: string[] = [];
			const phone = await device({ width: 390, height: 844 });
			await phone.goto(sim.thread("usage.telemetry"));
			await expect(phone.getByTestId("thread-page")).toBeVisible({
				timeout: 60_000,
			});

			// Open phone thread menu (HeaderMenu ⋯)
			const menuTrigger = phone.getByRole("button", { name: "Thread actions" });
			await expect(menuTrigger).toBeVisible({ timeout: 15_000 });
			await menuTrigger.click();

			// Inspect menu entries
			const menuItems = phone.locator(
				'[role="menuitem"], [role="menuitemcheckbox"]',
			);
			await expect(menuItems.first()).toBeVisible({ timeout: 10_000 });

			const texts = await menuItems.allTextContents();
			const hasFind = texts.some((t) => /find/i.test(t));
			if (!hasFind) {
				const shotPath = await shot("phone-menu-missing-find");
				fails.push(
					`phone thread menu has no "Find in thread" option (found: [${texts
						.map((t) => t.trim())
						.filter(Boolean)
						.join(", ")}]); shot: ${shotPath}`,
				);
			}

			await phone.close();
			return verdict(
				fails,
				hasFind
					? "phone thread menu opens find above the keyboard"
					: `phone thread menu lacks find action (found ${texts.length} items)`,
			);
		},
	},
]);
