// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { askRefusal } from "../../../src/lib/ask-refusal";
import { sidewaysFaults } from "../../steps/product";
import { defineChecks, verdict } from "../bar";

/**
 * #1101 category 5, Phone (web page at 390 px, not a native app).
 */
export default defineChecks([
	{
		item: "5.1",
		async run({ device }) {
			const phone = await device({ width: 390, height: 844 });
			await phone.goto("/new");
			await expect(phone.getByTestId("new-thread-page")).toBeVisible();
			const fails: string[] = [];

			const conn = phone.getByTestId("phone-connection");
			await expect(conn).toBeVisible();
			// Wait for initial connection stream to become connected
			await expect(conn).toHaveText(/Connected/, { timeout: 10000 });
			const connectedWord = (await conn.innerText()).trim();
			if (!connectedWord.includes("Connected")) {
				fails.push(
					`initial connection word is "${connectedWord}", expected "Connected"`,
				);
			}

			// Tap connection word to open popover
			await conn.click();
			const whyPopover = phone.getByTestId("phone-connection-why");
			await expect(whyPopover).toBeVisible();
			const whyText = (await whyPopover.innerText()).trim();

			// A second phone whose change stream cannot connect: the header must say so in words.
			const down = await device({ width: 390, height: 844 });
			await down.route("**/api/live/changes*", (route) => route.abort());
			await down.goto("/new");
			const downConn = down.getByTestId("phone-connection");
			await expect(downConn).toHaveText(/Reconnecting \(as of [^)]+\)/, {
				timeout: 20_000,
			});
			const reconnecting = (await downConn.innerText()).trim();
			await expect(downConn).toHaveText("Host unreachable", {
				timeout: 60_000,
			});
			await downConn.click();
			const reason = (
				await down.getByTestId("phone-connection-why").innerText()
			).trim();
			if (!/asleep/i.test(reason)) {
				fails.push(`Host unreachable gives the reason "${reason}"`);
			}
			await down.close();
			const wConn = { word: connectedWord };
			const wReconn = { word: reconnecting };
			const wSleep = { word: "Host unreachable", reason };

			await phone.close();

			return verdict(
				fails,
				`header reads "${wConn.word}" (popover: "${whyText}"); with the stream blocked it reads "${wReconn.word}", then "${wSleep.word}" with reason "${wSleep.reason}"`,
			);
		},
	},
	{
		item: "5.2",
		async run({ device }) {
			const phone = await device({ width: 390, height: 844 });
			await phone.goto("/new");
			await expect(phone.getByTestId("new-thread-page")).toBeVisible();
			const fails: string[] = [];

			const needsSection = phone.getByTestId("home-needs");
			await expect(needsSection).toBeVisible();

			const rows = phone.getByTestId("home-needs-row");
			await expect(rows.first()).toBeVisible({ timeout: 30_000 });
			// A row offers Answer once its ask has loaded, which the slow link delays (#1101).
			await phone
				.locator('[data-testid="home-fix"][data-fix="answer"]')
				.first()
				.waitFor({ timeout: 30_000 })
				.catch(() => undefined);
			const count = await rows.count();
			if (count === 0) {
				fails.push("no needs-you rows on Phone Home");
			}

			// Every row links to its thread; an answerable one opens its ask on a tap.
			let unlinked = 0;
			for (let i = 0; i < count; i++) {
				const href = await rows
					.nth(i)
					.locator("a")
					.first()
					.getAttribute("href");
				if (
					!href?.startsWith("/threads/") &&
					!href?.startsWith("/incidents/")
				) {
					unlinked++;
				}
			}
			if (unlinked > 0) fails.push(`${unlinked} of ${count} rows link nowhere`);
			const fixes = await rows
				.getByTestId("home-fix")
				.evaluateAll((els) => els.map((e) => e.getAttribute("data-fix")));
			const answer = phone.locator(
				'[data-testid="home-fix"][data-fix="answer"]',
			);
			const answerable = await answer.count();
			if (answerable === 0) {
				fails.push(
					`no row offers Answer; the rows' fixes are ${fixes.join(", ")}`,
				);
			} else {
				await answer.first().click();
				await expect(phone.getByTestId("home-ask-card")).toBeVisible();
			}

			return verdict(
				fails,
				`${count} attention rows on Phone Home, ${count - unlinked} link to their thread; ${answerable} offer Answer and the first opened its ask`,
			);
		},
	},
	{
		item: "5.3",
		async run({ device, sim }) {
			const phone = await device({ width: 390, height: 844 });
			// Seen first: a thread with nothing unseen opens at its tail; unseen activity opens at the divider (3.3).
			const path = sim.thread("seed: long-thread");
			const seen = await phone.request.post(
				`/api/threads/${path.split("/").pop()}/visit`,
			);
			if (!seen.ok())
				throw new Error(`marking the thread seen failed: ${seen.status()}`);
			await phone.goto(path);
			await expect(
				phone.getByTestId("thread-page"),
				"the 5,000-item thread page at 390 px",
			).toBeVisible({ timeout: 45_000 });
			const fails: string[] = [];

			// 1. Tail first with "N earlier"
			// The tail is on screen at open; the "N earlier" control sits at the window's top.
			const gapNow = () =>
				phone
					.getByTestId("transcript-scroller")
					.evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight);
			// The slow link paints the tail late, so the gap is read once it has settled.
			await expect
				.poll(gapNow, { timeout: 30_000 })
				.toBeLessThanOrEqual(40)
				.catch(() => undefined);
			const gap = await gapNow();
			if (gap > 40)
				fails.push(`the thread opens ${Math.round(gap)}px above its tail`);
			let earlierText = "";

			// 2. Tool rows collapsed: the steps sit in closed turn folds, and no tool row is open
			const tools = await phone.evaluate(() => {
				const rows = Array.from(
					document.querySelectorAll(
						'[data-testid="tool-line"], [data-testid="tool-group"]',
					),
				);
				const folds = Array.from(
					document.querySelectorAll(
						'[data-testid="turn-fold"], [data-testid="turn-fold-remote"]',
					),
				);
				return {
					total: rows.length + folds.length,
					open:
						rows.filter((r) => r.getAttribute("data-open") === "true").length +
						folds.filter((f) => f.getAttribute("aria-expanded") === "true")
							.length,
				};
			});
			const openTools = tools.open;
			if (tools.total === 0)
				fails.push("no tool row or step fold on screen to be collapsed");
			if (openTools > 0) {
				fails.push(
					`${openTools} of ${tools.total} tool rows and step folds are open by default`,
				);
			}

			// 3. No page-wide horizontal scroll
			const faults = await sidewaysFaults(phone);
			if (faults.length > 0) {
				fails.push(
					`horizontal scroll faults: ${faults.slice(0, 2).join("; ")}`,
				);
			}

			// 4. Composer stays above the keyboard (docked at bottom)
			const composer = phone.locator('[data-testid="thread-composer"]').first();
			await expect(composer, "the docked composer").toBeVisible({
				timeout: 45_000,
			});
			const box = await composer.boundingBox();
			if (!box || box.y + box.height < 700) {
				fails.push("composer not docked at viewport bottom");
			}

			// Scrolling up loads earlier pages; the control names what is still unloaded once its budget ends.
			const earlier = phone.getByTestId("transcript-earlier");
			const loopEnd = Date.now() + 70_000;
			while (Date.now() < loopEnd && !(await earlier.count())) {
				await phone
					.getByTestId("transcript-scroller")
					.evaluate((e) => e.scrollTo(0, 0));
				await phone.waitForTimeout(400);
			}
			if (!(await earlier.count())) {
				fails.push(
					"scrolling to the top for 70 s never showed an 'N earlier' control",
				);
			} else {
				earlierText = (await earlier.innerText()).trim();
				if (!/^\d+ earlier$/.test(earlierText))
					fails.push(
						`earlier button text is "${earlierText}", expected "N earlier"`,
					);
			}

			return verdict(
				fails,
				`tail first with "${earlierText}"; ${tools.total} tool rows, ${openTools} open; 0 horizontal faults; composer docked at y=${Math.round(box?.y ?? 0)}`,
			);
		},
	},
	{
		item: "5.4",
		async run({ device }) {
			const phone = await device({ width: 390, height: 844 });
			await phone.goto("/new");
			await expect(phone.getByTestId("new-thread-page")).toBeVisible();
			const fails: string[] = [];

			// Open each ask from its needs row
			const rows = phone.getByTestId("home-needs-row");
			await expect(rows.first()).toBeVisible();
			const rowCount = await rows.count();

			const seen: string[] = [];
			for (let i = 0; i < rowCount; i++) {
				const fix = rows.nth(i).getByTestId("home-fix");
				if (
					(await fix
						.getAttribute("data-fix", { timeout: 2000 })
						.catch(() => null)) !== "answer"
				)
					continue;
				await fix.click();
				const askCard = phone.getByTestId("home-ask-card");
				await expect(askCard).toBeVisible();
				if (await askCard.getByTestId("row-ask-approve").isVisible()) {
					const denyReason = askCard.getByTestId("row-ask-deny-reason");
					if (!(await askCard.getByTestId("row-ask-decline").isVisible()))
						fails.push("Decline button missing on card");
					await denyReason.click();
					if (!(await askCard.getByTestId("row-ask-reason").isVisible()))
						fails.push("Deny with reason did not reveal a reason input");
					seen.push("approve/decline/deny-with-reason");
				} else if ((await askCard.getByTestId("row-ask-option").count()) > 0) {
					seen.push("answer options");
				} else {
					fails.push(`row ${i + 1}: ask opened with no Approve or option`);
				}
				await phone.keyboard.press("Escape");
			}
			if (seen.length === 0)
				fails.push(`none of ${rowCount} rows offers Answer`);
			if (!seen.some((x) => x.startsWith("approve"))) {
				fails.push("no approval ask on Home showed Approve, Decline and Deny");
			}
			if (!seen.includes("answer options")) {
				fails.push("no question ask on Home showed answer options");
			}

			// Device level refusal check
			const ref = askRefusal({ kind: "permission", requiresHost: true }, false);
			const refusalText = ref?.text ?? "";

			if (
				!refusalText.toLowerCase().includes("only the computer") &&
				!refusalText.toLowerCase().includes("only the machine")
			) {
				fails.push(
					`refusal message "${refusalText}" does not explain who can answer`,
				);
			}

			await phone.close();

			return verdict(
				fails,
				`${seen.length} asks opened from rows (${Array.from(new Set(seen)).join(", ")}); the refusal function says "${refusalText}"`,
			);
		},
	},
	{
		item: "5.5",
		async run({ device }) {
			const phone = await device({ width: 390, height: 844 });
			await phone.goto("/settings?tab=devices");
			await expect(phone.getByTestId("settings-frame")).toBeVisible();
			const fails: string[] = [];

			// 1. Manifest and icon
			const manifestCheck = await phone.evaluate(async () => {
				const link = document.querySelector<HTMLLinkElement>(
					'link[rel="manifest"]',
				);
				if (!link?.href) return { ok: false, error: "no manifest link" };
				try {
					const res = await fetch(link.href);
					if (!res.ok)
						return { ok: false, error: `manifest HTTP ${res.status}` };
					const json = await res.json();
					const hasIcons = Array.isArray(json.icons) && json.icons.length > 0;
					return { ok: true, name: json.name, icons: hasIcons };
				} catch (e) {
					return { ok: false, error: String(e) };
				}
			});

			if (!manifestCheck.ok) {
				fails.push(`manifest failed: ${manifestCheck.error}`);
			} else if (!manifestCheck.icons) {
				fails.push("manifest has no icons");
			}

			// 2. Push opt-in with Test button under Devices
			const pushToggle = phone.locator("text=/push notifications|web push/i");
			const testBtn = phone
				.getByTestId("device-row")
				.locator('button:has-text("Test")');

			// The rows load after the frame on the slow link.
			await phone
				.getByTestId("device-row")
				.first()
				.waitFor({ timeout: 20_000 })
				.catch(() => {});
			const hasPush = (await pushToggle.count()) > 0;
			const rowCount = await phone.getByTestId("device-row").count();
			const hasTest = rowCount > 0 && (await testBtn.count()) >= rowCount;

			if (!hasPush) {
				fails.push("Devices tab lacks push opt-in");
			}
			if (!hasTest) {
				fails.push("Devices tab lacks Test button on devices");
			}

			await phone.close();

			return verdict(
				fails,
				`manifest: ok (${manifestCheck.name}, icons=${manifestCheck.icons}); push opt-in: ${hasPush}; device Test buttons: ${hasTest}`,
			);
		},
	},
	{
		item: "5.6",
		async run({ page, open }) {
			await open("/settings?tab=devices", "settings-frame");
			const fails: string[] = [];

			const rows = page.getByTestId("device-row");
			await expect(rows.first()).toBeVisible();
			const count = await rows.count();

			const names: string[] = [];
			for (let i = 0; i < count; i++) {
				const row = rows.nth(i);
				const nameEl = row.getByTestId("device-name");
				const name = (await nameEl.innerText()).trim();
				names.push(name);
				if (!name) fails.push(`device row ${i + 1} has empty name`);

				const revokeBtn = row.getByTestId("device-revoke");
				if (!(await revokeBtn.isVisible())) {
					fails.push(`device "${name}" lacks visible Revoke button`);
				}
			}

			return verdict(
				fails,
				`${count} paired devices (${names.join(", ")}), each with a visible Revoke button`,
			);
		},
	},
	{
		item: "5.7",
		async run({ device }) {
			const phone = await device({ width: 390, height: 844 });
			await phone.goto("/new");
			await expect(phone.getByTestId("new-thread-page")).toBeVisible();
			const fails: string[] = [];

			// 1. Status is a word, not colour alone
			await phone
				.locator("span[data-status]")
				.first()
				.waitFor({ timeout: 30_000 })
				.catch(() => undefined);
			const statusCheck = await phone.evaluate(() => {
				const els = Array.from(document.querySelectorAll("span[data-status]"));
				const empty = els.filter((el) => !(el.textContent ?? "").trim());
				return {
					total: els.length,
					emptyCount: empty.length,
					first: empty[0]?.outerHTML.slice(0, 100) ?? "",
				};
			});

			if (statusCheck.total === 0)
				fails.push("no status element on Phone Home");
			if (statusCheck.emptyCount > 0) {
				fails.push(
					`${statusCheck.emptyCount} of ${statusCheck.total} status elements lack text: ${statusCheck.first}`,
				);
			}

			// 2. Tap targets at least 44 px on mobile
			const smallTargets = await phone.evaluate(() => {
				const sel =
					"button, a[href], input:not([type=hidden]), [role=button], [role=tab]";
				const small: { name: string; w: number; h: number }[] = [];
				for (const el of Array.from(
					document.querySelectorAll<HTMLElement>(sel),
				)) {
					const r = el.getBoundingClientRect();
					if (
						r.width === 0 ||
						r.height === 0 ||
						r.bottom < 0 ||
						r.top > innerHeight
					)
						continue;
					if (r.width <= 1 && r.height <= 1) continue;
					// What a finger hits: the box, widened by a ::after tap area (tokens.css, #848).
					const a = getComputedStyle(el, "::after");
					const on = a.content !== "none" && a.position === "absolute";
					const w = Math.max(r.width, on ? Number.parseFloat(a.width) || 0 : 0);
					const h = Math.max(
						r.height,
						on ? Number.parseFloat(a.height) || 0 : 0,
					);
					if (w < 44 || h < 44) {
						small.push({
							name: (
								el.getAttribute("aria-label") ??
								el.textContent ??
								el.tagName
							)
								.trim()
								.slice(0, 30),
							w: Math.round(w),
							h: Math.round(h),
						});
					}
				}
				return small;
			});

			if (smallTargets.length > 0) {
				const sample = smallTargets
					.slice(0, 4)
					.map((t) => `"${t.name}" (${t.w}x${t.h})`)
					.join(", ");
				fails.push(
					`${smallTargets.length} controls under 44 px target size: ${sample}`,
				);
			}

			return verdict(
				fails,
				`${statusCheck.total} status elements all with text; 0 visible controls under 44 px at 390 px`,
			);
		},
	},
]);
