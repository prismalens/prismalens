// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { defineChecks, verdict } from "../bar";

/** #1101 category 14, Transcript rail. */
export default defineChecks([
	{
		item: "14.1",
		async run({ page, open, sim }) {
			await open(sim.thread("seed: long-thread"));
			const rail = page.getByTestId("transcript-rail");
			await expect(rail).toBeVisible({ timeout: 45_000 });

			const fails: string[] = [];
			const railBox = await rail.boundingBox({ timeout: 10_000 });
			const scroller = page.getByTestId("transcript-scroller");
			const scrollerBox = await scroller.boundingBox({ timeout: 10_000 });

			if (!railBox || !scrollerBox) {
				return verdict(["could not read bounding boxes"], "");
			}

			// Rail sits at the far left against sidebar (pane gutter), not beside the center column
			if (railBox.x > scrollerBox.x + 30) {
				fails.push(
					`rail is not against the sidebar at pane left edge (rail x=${railBox.x}, pane x=${scrollerBox.x})`,
				);
			}

			const dashes = page.getByTestId("rail").locator("[data-rail-item]");
			const dashCount = await dashes.count();
			if (dashCount === 0) {
				fails.push("no dashes rendered in rail");
			}

			const currentDash = page
				.getByTestId("rail")
				.locator("[data-current='true']");
			const hasCurrent = (await currentDash.count()) > 0;
			let currentW = 0;
			let otherW = 0;
			if (!hasCurrent) {
				fails.push("no current turn dash marked");
			} else {
				const currentBox = await currentDash.boundingBox();
				const otherDash = page
					.getByTestId("rail")
					.locator("[data-rail-item]:not([data-current='true'])")
					.first();
				const otherBox = await otherDash.boundingBox();
				currentW = currentBox?.width ?? 0;
				otherW = otherBox?.width ?? 0;
				if (currentBox && otherBox && currentBox.width <= otherBox.width) {
					fails.push(
						`current dash width (${currentBox.width}px) is not longer than rest (${otherBox.width}px)`,
					);
				}
			}

			await dashes.first().hover();
			const card = page.getByTestId("rail-card");
			await expect(card).toBeVisible({ timeout: 15_000 });
			const cardBox = await card.boundingBox({ timeout: 10_000 });
			// The words on screen under the card: any transcript text its box overlaps is covered.
			const covered = cardBox
				? await page.evaluate((c) => {
						const hit: string[] = [];
						const w = document.createTreeWalker(
							document.querySelector("[data-testid=transcript]") ??
								document.body,
							NodeFilter.SHOW_TEXT,
						);
						for (let n = w.nextNode(); n; n = w.nextNode()) {
							const t = n.textContent?.trim();
							if (!t) continue;
							const r = document.createRange();
							r.selectNodeContents(n);
							for (const b of Array.from(r.getClientRects()))
								if (
									b.width > 0 &&
									b.left < c.x + c.width &&
									b.right > c.x &&
									b.top < c.y + c.height &&
									b.bottom > c.y
								) {
									hit.push(t.slice(0, 30));
									break;
								}
						}
						return hit;
					}, cardBox)
				: [];
			if (covered.length)
				fails.push(
					`the hover card (x ${Math.round(cardBox?.x ?? 0)}-${Math.round((cardBox?.x ?? 0) + (cardBox?.width ?? 0))}) covers ${covered.length} message lines, e.g. "${covered[0]}"`,
				);

			return verdict(
				fails,
				`rail at far left against sidebar (x=${Math.round(railBox.x)}), ${dashCount} dashes windowed, current dash width ${Math.round(currentW)}px vs ${Math.round(otherW)}px, hover card at x ${cardBox ? Math.round(cardBox.x) : 0}-${cardBox ? Math.round(cardBox.x + cardBox.width) : 0}px covers no message text`,
			);
		},
	},
	{
		item: "14.2",
		async run({ page, open, sim }) {
			await open(sim.thread("seed: long-thread"));
			const rail = page.getByTestId("rail");
			await expect(rail).toBeVisible();

			const fails: string[] = [];
			await rail.focus();
			const card = page.getByTestId("rail-card");
			await expect(card).toBeVisible();

			const title = await card.locator(".font-semibold").innerText();
			if (!title.trim()) fails.push("card prompt title is empty");

			const body = await card.locator(".line-clamp-3").innerText();
			if (!body.trim()) fails.push("card agent excerpt is empty");

			// Press Home on rail to target Turn 1 in unloaded start region, then Enter to jump
			await page.keyboard.press("Home");
			await page.keyboard.press("Enter");

			// Wait for the jump to land: the transcript should display Turn 1
			const item = page.getByTestId("transcript-item").first();
			await expect(item).toContainText(/Turn 1:/);
			const itemText = await item.innerText();

			return verdict(
				fails,
				`card shows bold title "${title.slice(0, 30)}" and 3-line clamped excerpt "${body.slice(0, 30)}", Home+Enter jumped and loaded Turn 1 into view ("${itemText.slice(0, 40)}…")`,
			);
		},
	},
	{
		item: "14.3",
		async run({ page, open, sim }) {
			await open(sim.thread("seed: long-thread"));
			const rail = page.getByTestId("rail");
			await expect(rail).toBeVisible();

			const fails: string[] = [];
			await rail.focus();
			await page.keyboard.press("Home");

			// Each PageDown lands the card on the next break; the lit dash is the one under the card.
			const tone: Record<string, string> = {
				compaction: "bg-text-3",
				limit: "bg-warn",
				restart: "bg-info",
				failure: "bg-danger",
			};
			const seen = new Map<string, string>();
			for (let i = 0; i < 10 && seen.size < 4; i++) {
				await page.keyboard.press("PageDown");
				const lit = rail.locator("[data-rail-item].w-5");
				if ((await lit.count()) !== 1) continue;
				const kind = (await lit.getAttribute("data-rail-item")) ?? "";
				if (kind === "turn" || seen.has(kind)) continue;
				const cls = (await lit.getAttribute("class")) ?? "";
				const title = (
					await page
						.getByTestId("rail-card")
						.locator(".font-semibold")
						.innerText()
				).trim();
				seen.set(kind, title);
				const want = tone[kind];
				if (!want || !cls.split(" ").includes(want))
					fails.push(`${kind} dash has classes "${cls}", expected ${want}`);
				if (!title) fails.push(`${kind} card names no break`);
				if (kind === "limit" && !/resets \d{1,2}:\d{2}/.test(title))
					fails.push(`limit card "${title}" gives no reset time`);
			}
			for (const kind of Object.keys(tone))
				if (!seen.has(kind)) fails.push(`no ${kind} break dash reached`);

			return verdict(
				fails,
				`${seen.size} break kinds reached with PageDown, each in its tone (${Array.from(
					seen,
				)
					.map(([k, t]) => `${k}: "${t}"`)
					.join("; ")})`,
			);
		},
	},
	{
		item: "14.4",
		async run({ page, open, sim }) {
			await open(sim.thread("seed: long-thread"));
			const rail = page.getByTestId("rail");
			await expect(rail).toBeVisible();

			const fails: string[] = [];
			const dashes = rail.locator("[data-rail-item]");
			const count = await dashes.count();
			if (count !== 15) {
				fails.push(`expected 15 dashes windowed around position, got ${count}`);
			}

			// The ends fade: edge dashes have reduced opacity
			const firstOpacity = await dashes
				.first()
				.evaluate((el) => el.style.opacity);
			const lastOpacity = await dashes
				.last()
				.evaluate((el) => el.style.opacity);
			const midOpacity = await dashes.nth(7).evaluate((el) => el.style.opacity);

			// The thread opens at its tail, so only the top has more beyond it.
			if (firstOpacity !== "0.3") {
				fails.push(`top end dash opacity is "${firstOpacity}", expected 0.3`);
			}
			const secondOpacity = await dashes
				.nth(1)
				.evaluate((el) => el.style.opacity);
			if (secondOpacity !== "0.6") {
				fails.push(`second dash opacity is "${secondOpacity}", expected 0.6`);
			}
			if (midOpacity === "0.3" || midOpacity === "0.6") {
				fails.push(`middle dash should not fade (mid=${midOpacity})`);
			}

			return verdict(
				fails,
				`exactly 15 dashes rendered in window, top end fading (first opacity=${firstOpacity || "none"}, last opacity=${lastOpacity || "none"}, middle=${midOpacity || "1"})`,
			);
		},
	},
	{
		item: "14.5",
		async run({ page, open, sim }) {
			await open(sim.thread("seed: long-thread"));
			const rail = page.getByTestId("rail");
			await expect(rail).toBeVisible();

			const fails: string[] = [];
			const initialHits = await rail.locator("[data-hit='true']").count();
			if (initialHits !== 0) {
				fails.push(`expected 0 hits before find is opened, got ${initialHits}`);
			}

			// Read title of turn currently visible in the active window
			await rail.focus();
			const card = page.getByTestId("rail-card");
			await expect(card).toBeVisible();
			const turnTitle = await card.locator(".font-semibold").innerText();
			const query = turnTitle.slice(0, 8); // e.g. "Turn 238"

			// Open find with Ctrl+F
			await page.keyboard.press("Control+f");
			const findBar = page.getByTestId("find-bar");
			await expect(findBar).toBeVisible();

			const input = page.getByTestId("find-input");
			await input.fill(query);
			await expect(page.getByTestId("find-count")).toHaveText(
				/^[1-9][0-9]*\/[0-9]+$/,
				{ timeout: 30_000 },
			);

			await expect
				.poll(() => rail.locator("[data-hit='true']").count(), {
					timeout: 10_000,
				})
				.toBeGreaterThan(0)
				.catch(() => undefined);
			const openHits = await rail.locator("[data-hit='true']").count();
			if (openHits === 0) {
				fails.push(
					`no dash marked with data-hit while find is open for query "${query}"`,
				);
			}

			// The active hit's dash is the current one, and it is a hit dash
			const activeIsHit =
				(await rail
					.locator("[data-current='true'][data-hit='true']")
					.count()) === 1;
			if (!activeIsHit) {
				fails.push("the current dash is not the active find hit's dash");
			}

			// Close find with Escape
			await page.keyboard.press("Escape");
			await expect(findBar).toBeHidden();

			const closedHits = await rail.locator("[data-hit='true']").count();
			if (closedHits !== 0) {
				fails.push(`expected 0 hits after find is closed, got ${closedHits}`);
			}

			return verdict(
				fails,
				`find hits marked on rail (${openHits} dashes with data-hit) only while find is open; 0 hits before and after; the active hit's dash is the current one`,
			);
		},
	},
	{
		item: "14.6",
		async run({ page, open, sim, device }) {
			await open(sim.thread("seed: long-thread"));
			const rail = page.getByTestId("rail");
			await expect(rail).toBeVisible();

			const fails: string[] = [];
			await rail.focus();
			const card = page.getByTestId("rail-card");
			await expect(card).toBeVisible();

			const t0 = await card.locator(".font-semibold").innerText();
			await page.keyboard.press("ArrowDown");
			const t1 = await card.locator(".font-semibold").innerText();
			if (t0 === t1) {
				fails.push("ArrowDown did not move the card to next turn");
			}

			await page.keyboard.press("End");
			const tEnd = await card.locator(".font-semibold").innerText();
			await page.keyboard.press("Home");
			const tHome = await card.locator(".font-semibold").innerText();
			if (tEnd === tHome) {
				fails.push("Home and End did not move between first and last turn");
			}

			// F jumps forward to the next failure break: the card and lit dash land on it
			await page.keyboard.press("f");
			const lit = rail.locator("[data-rail-item].w-5");
			await expect(lit).toHaveAttribute("data-rail-item", "failure", {
				timeout: 20_000,
			});
			const kind = await lit.getAttribute("data-rail-item");
			const failTitle = (
				await card.locator(".font-semibold").innerText()
			).trim();
			// The card's second line is "<time> · <why>"; the transcript's own line says the why.
			const cardBody = (await card.innerText()).replace(failTitle, "").trim();
			const why = cardBody.split("·").pop()?.trim() ?? "";
			if (!why) fails.push(`the failure card gives no reason: "${cardBody}"`);
			await expect(
				page.getByTestId("transcript").getByText(why, { exact: true }).first(),
			).toBeInViewport({ timeout: 30_000 });

			// Screen reader jump links
			const links = page.getByTestId("rail-links").locator("button");
			const linkCount = await links.count();
			if (linkCount < 10) {
				fails.push(
					`expected screen-reader jump links per turn, got ${linkCount}`,
				);
			}

			// Phone shows no rail
			const phone = await device({ width: 390, height: 844 });
			await phone.goto(sim.thread("seed: long-thread"));
			await expect(phone.getByTestId("thread-page")).toBeVisible();
			await expect(phone.getByTestId("transcript")).toContainText(/Turn \d+/, {
				timeout: 60_000,
			});
			const phoneRail = phone.getByTestId("transcript-rail");
			if ((await phoneRail.count()) > 0 && (await phoneRail.isVisible())) {
				fails.push("rail is visible on 390px phone device");
			}
			await phone.context().close();

			return verdict(
				fails,
				`keys (ArrowDown, Home, End) move the card and F lands on the failure break "${failTitle}" (kind="${kind}") in view; ${linkCount} screen-reader jump links; rail is hidden on phone`,
			);
		},
	},
]);
