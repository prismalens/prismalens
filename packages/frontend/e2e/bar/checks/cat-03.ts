// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { defineChecks, verdict } from "../bar";

/** #1101 category 3, Away view and catching up. */
export default defineChecks([
	{
		item: "3.1",
		async run({ page, open, device, sim }) {
			await open("/new");
			const digest1 = page.getByTestId("away-digest");
			await expect(digest1).toBeVisible();

			const phone = await device();
			await phone.goto(`${sim.url}/new`);
			const digest2 = phone.getByTestId("away-digest");
			await expect(digest2).toBeVisible();

			const getDigestData = async (p: typeof page) => {
				const link = p.getByTestId("away-digest-link");
				const sinceText = (await link.textContent())?.trim() ?? "";
				const lines = p.getByTestId("away-digest").getByTestId("away-line");
				const titles = await lines.evaluateAll((els) =>
					els.map(
						(el) => el.querySelector(".text-text-1")?.textContent?.trim() ?? "",
					),
				);
				return { sinceText, titles };
			};

			const desktop = await getDigestData(page);
			const mobile = await getDigestData(phone);
			await phone.close();

			const fails: string[] = [];
			if (!desktop.sinceText) {
				fails.push("desktop away digest has no 'Since ...' baseline link");
			}
			if (desktop.sinceText !== mobile.sinceText) {
				fails.push(
					`desktop baseline ("${desktop.sinceText}") disagrees with phone baseline ("${mobile.sinceText}")`,
				);
			}
			if (desktop.titles.length === 0) {
				fails.push("the away digest lists no changed threads to compare");
			}
			if (desktop.titles.join(",") !== mobile.titles.join(",")) {
				fails.push(
					`desktop (${desktop.titles.length} changed) disagrees with phone (${mobile.titles.length} changed) on changed threads`,
				);
			}

			return verdict(
				fails,
				`desktop and phone agree on baseline "${desktop.sinceText}" and ${desktop.titles.length} changed threads`,
			);
		},
	},
	{
		item: "3.2",
		async run({ page, open }) {
			await open("/new");
			const digest = page.getByTestId("away-digest");
			await expect(digest).toBeVisible();

			const lines = digest.getByTestId("away-line");
			const count = await lines.count();

			const fails: string[] = [];
			if (count === 0) {
				fails.push("no changed threads listed in Home away digest");
			}

			const lineData = await lines.evaluateAll((els) =>
				els.map((el) => {
					const title =
						el.querySelector(".text-text-1")?.textContent?.trim() ?? "";
					const status = el.getAttribute("data-state") ?? "";
					const detail =
						el
							.querySelector("span[dir=auto].text-text-3")
							?.textContent?.trim() ||
						el.querySelector(".max-sm\\:hidden")?.textContent?.trim() ||
						"";
					return { title, status, detail };
				}),
			);

			for (const l of lineData) {
				if (!l.title) {
					fails.push("digest line is missing thread title");
				}
				if (!l.status) {
					fails.push(`digest line "${l.title}" is missing status indicator`);
				}
				if (!l.detail) {
					fails.push(
						`digest line "${l.title}" is missing detail line (shows count or title alone)`,
					);
				}
			}

			const sample = lineData[0];
			return verdict(
				fails,
				`Home lists ${lineData.length} changed threads with title, status and detail (e.g. "${sample?.title}: ${sample?.detail}")`,
			);
		},
	},
	{
		item: "3.3",
		async run({ page, open }) {
			await open("/new");
			const digest = page.getByTestId("away-digest");
			await expect(digest).toBeVisible();

			// Open the changed threads in turn until one lands on a divider.
			const lineCount = await digest.getByTestId("away-line").count();
			const fails: string[] = [];
			let text = "";
			let inView = false;
			let tried = 0;
			for (let i = 0; i < Math.min(lineCount, 5) && !text; i++) {
				if (i > 0) await open("/new");
				const line = page
					.getByTestId("away-digest")
					.getByTestId("away-line")
					.nth(i);
				await expect(line).toBeVisible();
				await line.click();
				tried++;
				await expect(page.getByTestId("thread-page")).toBeVisible();
				const divider = page.getByTestId("unseen-divider");
				const shown = await expect(divider)
					.toBeVisible({ timeout: 8000 })
					.then(
						() => true,
						() => false,
					);
				if (shown) {
					text = (await divider.textContent())?.trim() ?? "";
					inView = await divider.evaluate((el) => {
						const r = el.getBoundingClientRect();
						return r.top >= 0 && r.bottom <= innerHeight;
					});
				}
			}

			if (lineCount === 0) fails.push("no changed thread on Home to open");
			else if (!text) {
				fails.push(
					`none of ${tried} changed threads opened at an unseen divider`,
				);
			} else {
				if (!/\d+\s+new since/i.test(text)) {
					fails.push(
						`unseen divider text does not match "N new since ...": "${text}"`,
					);
				}
				if (!inView) fails.push("the unseen divider is not in the viewport");
			}

			return verdict(
				fails,
				`thread ${tried} of ${lineCount} lands on the divider "${text}" in view`,
			);
		},
	},
	{
		item: "3.5",
		async run({ page, open }) {
			await open("/new");
			const tree = page.getByTestId("thread-tree");
			await expect(tree).toBeVisible();

			const countEl = page.getByTestId("thread-section-needs-count");
			await expect(countEl).toBeVisible();
			const countText = (await countEl.textContent())?.trim() ?? "";
			const count = Number.parseInt(countText, 10);

			const title = await page.title();
			const fails: string[] = [];

			if (count > 0) {
				const expectedPrefix = `(${count})`;
				if (!title.startsWith(expectedPrefix)) {
					fails.push(
						`tab title "${title}" does not start with needs-you count prefix "${expectedPrefix}"`,
					);
				}
			} else {
				fails.push(`needs-you count is ${count}, expected > 0`);
			}

			return verdict(
				fails,
				`tab title "${title}" carries needs-you count (${count})`,
			);
		},
	},
	{
		item: "3.6",
		async run({ page, open }) {
			await open("/events", "events-page");
			const eventsPage = page.getByTestId("events-page");
			await expect(eventsPage).toBeVisible();

			const list = page.getByTestId("event-list");
			await expect(list).toBeVisible();

			const fails: string[] = [];
			const unreadTab = list.locator('[role="tab"]:has-text("Unread")');
			const allTab = list.locator('[role="tab"]:has-text("All")');

			if (!(await unreadTab.isVisible().catch(() => false))) {
				fails.push("Unread tab is missing from event list");
			}
			if (!(await allTab.isVisible().catch(() => false))) {
				fails.push("All tab is missing from event list");
			}

			const markAll = page.getByTestId("events-mark-all");
			if (!(await markAll.isVisible().catch(() => false))) {
				fails.push("Mark all read button is missing from event list");
			} else {
				const markAllText = (await markAll.textContent())?.trim() ?? "";
				if (!markAllText.includes("Mark all read")) {
					fails.push(
						`button text is "${markAllText}", expected "Mark all read"`,
					);
				}
			}

			return verdict(
				fails,
				"event list at /events has Unread and All tabs and Mark all read button",
			);
		},
	},
	{
		item: "3.7",
		async run({ page, open }) {
			await open("/events", "events-page");
			const list = page.getByTestId("event-list");
			await expect(list).toBeVisible();

			// Switch to All tab to ensure full coverage
			const allTab = list.locator('[role="tab"]:has-text("All")');
			await allTab.click();

			await expect(page.getByRole("status", { name: "Loading" }))
				.not.toBeVisible({ timeout: 10000 })
				.catch(() => {});

			const rows = list.getByTestId("event-row");
			await rows
				.first()
				.waitFor({ state: "visible", timeout: 10000 })
				.catch(() => {});
			const count = await rows.count();

			const fails: string[] = [];
			if (count === 0) {
				fails.push("no event rows found in event list");
			}

			const api = await page.request.get(
				"/api/attention/events?filter=all&limit=200",
			);
			const body = (await api.json()) as {
				events: { thread: { kind: string; incident: unknown } }[];
			};
			const incidents = body.events.filter((e) => e.thread.incident).length;
			const chats = body.events.filter(
				(e) => !e.thread.incident && e.thread.kind === "chat",
			).length;
			if (incidents === 0) fails.push("no incident thread has an event");
			if (chats === 0) fails.push("no chat thread has an event");

			return verdict(
				fails,
				`event list shows ${count} rows; the server's ${body.events.length} events cover ${incidents} incident and ${chats} chat events`,
			);
		},
	},
]);
