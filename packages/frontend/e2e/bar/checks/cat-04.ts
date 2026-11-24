// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";
import type { AttentionEvent, AttentionThread } from "@prismalens/contracts";
import { decide } from "../../../src/lib/attention/notify-rules";
import { defineChecks, type Sim, verdict } from "../bar";

function makeThread(partial: Partial<AttentionThread> = {}): AttentionThread {
	return {
		id: "th-1",
		title: "Test",
		kind: "chat",
		startedBy: null,
		incident: null,
		cause: null,
		nextCommand: null,
		answer: null,
		status: null,
		error: null,
		endReason: null,
		follow: null,
		...partial,
	};
}

function makeEvent(
	partial: Partial<AttentionEvent> &
		Pick<AttentionEvent, "id" | "threadId" | "kind" | "notify">,
): AttentionEvent {
	return {
		detail: null,
		resetsAt: null,
		at: new Date().toISOString(),
		readAt: null,
		silenced: false,
		thread: makeThread(),
		...partial,
	};
}

const threadId = (sim: Sim, condition: string) =>
	sim.thread(condition).split("/").pop() ?? "";

/** A needs-you event the server never sent, for a real sim thread: the app must react to it. */
function needsEvent(n: number, id: string): AttentionEvent {
	return makeEvent({
		id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
		threadId: id,
		kind: "needs_you",
		notify: true,
		detail: "Run the migration?",
		thread: makeThread({ id, title: `Injected ${n}`, status: "approval" }),
	});
}

interface Armed {
	/** Events the next unread-events reads add on top of the server's. */
	inject: AttentionEvent[];
	/** How many unread-events reads the app has made. */
	reads: () => number;
	/** Pokes the app to read again now instead of at its interval. */
	poke: () => Promise<void>;
	notes: () => Promise<{ tag: string | null }[]>;
	fired: () => Promise<number>;
	badge: () => Promise<number[]>;
	fireNote: (i: number) => Promise<void>;
}

/** Routes the prefs and the unread feed, and stubs Notification, window.focus and the app badge. */
async function arm(page: Page): Promise<Armed> {
	await page.addInitScript(() => {
		type Note = { tag: string | null; click: () => void };
		const w = window as unknown as {
			__notes: Note[];
			__focus: number;
			__badge: number[];
		};
		w.__notes = [];
		w.__focus = 0;
		w.__badge = [];
		class FakeNotification {
			static permission = "granted";
			static requestPermission = async () => "granted";
			onclick: (() => void) | null = null;
			constructor(_title: string, opts?: { tag?: string }) {
				w.__notes.push({
					tag: opts?.tag ?? null,
					click: () => this.onclick?.(),
				});
			}
			close() {}
		}
		Object.defineProperty(window, "Notification", { value: FakeNotification });
		window.focus = () => {
			w.__focus++;
		};
		Object.defineProperty(navigator, "setAppBadge", {
			value: async (n?: number) => {
				w.__badge.push(n ?? 0);
			},
		});
	});
	const state = { inject: [] as AttentionEvent[], reads: 0 };
	// With the change stream down the app polls the feed every 10 s, which is how it sees our events.
	await page.route("**/api/live/changes*", (route) => route.abort());
	await page.route("**/api/attention/prefs*", async (route) => {
		if (route.request().method() !== "GET") return route.continue();
		await route.fulfill({
			json: {
				mode: "both",
				events: { needsYou: true, finished: true, failed: true },
				when: "always",
			},
		});
	});
	await page.route("**/api/attention/events*", async (route) => {
		const url = new URL(route.request().url());
		if (url.searchParams.get("filter") !== "unread") return route.continue();
		state.reads++;
		const res = await route.fetch();
		const body = (await res.json()) as {
			events: AttentionEvent[];
			unread: number;
		};
		await route.fulfill({
			response: res,
			json: {
				events: [...state.inject, ...body.events],
				unread: body.unread + state.inject.length,
			},
		});
	});
	type W = {
		__notes: { tag: string | null; click: () => void }[];
		__focus: number;
		__badge: number[];
	};
	return {
		get inject() {
			return state.inject;
		},
		set inject(v) {
			state.inject = v;
		},
		reads: () => state.reads,
		poke: () =>
			page.evaluate(() => {
				window.dispatchEvent(new Event("focus"));
				document.dispatchEvent(new Event("visibilitychange"));
			}),
		notes: () =>
			page.evaluate(() =>
				(window as unknown as W).__notes.map((n) => ({ tag: n.tag })),
			),
		fired: () => page.evaluate(() => (window as unknown as W).__focus),
		badge: () => page.evaluate(() => (window as unknown as W).__badge),
		fireNote: (i) =>
			page.evaluate((n) => (window as unknown as W).__notes[n]?.click(), i),
	};
}

/** Lets the app read the unread feed once with the injected events in it. */
async function deliver(page: Page, a: Armed, events: AttentionEvent[]) {
	const before = a.reads();
	a.inject = events;
	await expect
		.poll(
			async () => {
				await a.poke();
				return a.reads() > before;
			},
			{ timeout: 45_000, intervals: [500, 1000, 2000] },
		)
		.toBe(true);
	await page.waitForTimeout(500);
}

/**
 * #1101 category 4, Notifications.
 */
export default defineChecks([
	{
		item: "4.1",
		async run({ page, open }) {
			await open("/settings?tab=notifications", "settings-frame");
			const fails: string[] = [];

			// 1. Mode: Off / Notifications / Sound / Both
			const modeTrigger = page.getByTestId("notify-mode");
			await expect(modeTrigger).toBeVisible();
			await modeTrigger.click();
			const modeMenu = page.locator('[role="listbox"]').first();
			await expect(modeMenu).toBeVisible();
			const modeTexts = await modeMenu
				.locator('[role="option"]')
				.allInnerTexts();
			await page.keyboard.press("Escape");

			const expectedModes = [
				"Off",
				"Notifications",
				"Sound",
				"Notifications and sound",
			];
			for (const m of expectedModes) {
				if (!modeTexts.some((t) => t.trim() === m)) {
					fails.push(`mode missing: ${m}`);
				}
			}
			if (modeTexts.length !== expectedModes.length) {
				fails.push(
					`${modeTexts.length} modes, expected ${expectedModes.length}`,
				);
			}

			// 2. Events: needs you, finished, failed
			const needsYou = page.getByTestId("notify-needs-you");
			const finished = page.getByTestId("notify-finished");
			const failed = page.getByTestId("notify-failed");

			if (!(await needsYou.isVisible()))
				fails.push("no needs-you event switch");
			if (!(await finished.isVisible())) fails.push("no finished event switch");
			if (!(await failed.isVisible())) fails.push("no failed event switch");

			// 3. When: only while unfocused, or always
			const when = page.getByTestId("notify-when");
			if (!(await when.isVisible()))
				fails.push("no when (Also while looking) switch");

			// 4. Permission state with fix hint
			const permRow = page.getByTestId("notify-permission");
			await expect(permRow).toBeVisible();
			const permText = await permRow.innerText();
			if (!permText.trim()) fails.push("no browser permission state shown");

			return verdict(
				fails,
				`mode has 4 options (${modeTexts.join(", ")}); 3 event toggles; when toggle; permission row: "${permText.replace(/\s+/g, " ").trim()}"`,
			);
		},
	},
	{
		item: "4.2",
		async run({ page, open }) {
			await open("/events", "events-page");
			const res = await page.request.get(
				"/api/attention/events?filter=all&limit=200",
			);
			const { events } = (await res.json()) as { events: AttentionEvent[] };
			const started = events.filter(
				(e) => e.thread.startedBy && e.thread.follow === null,
			);
			const quiet = started.filter(
				(e) => e.kind === "finished" || e.kind === "failed",
			);
			const asking = started.filter((e) => e.kind === "needs_you");
			const fails: string[] = [];
			if (quiet.length === 0)
				fails.push("no agent-started finished or failed event");
			if (asking.length === 0) fails.push("no agent-started needs-you event");
			const loud = quiet.filter((e) => e.notify);
			if (loud.length > 0) {
				fails.push(
					`${loud.length} agent-started finished/failed events notify`,
				);
			}
			const mute = asking.filter((e) => !e.notify);
			if (mute.length > 0) {
				fails.push(
					`${mute.length} agent-started needs-you events do not notify`,
				);
			}

			return verdict(
				fails,
				`server events of agent-started threads: ${asking.length} needs-you all notify, ${quiet.length} finished/failed none notify`,
			);
		},
	},
	{
		item: "4.3",
		async run({ page, open, sim }) {
			const armed = await arm(page);
			await open("/new", "new-thread-page");
			await page.bringToFront();
			const fails: string[] = [];
			if (!(await page.evaluate(() => document.hasFocus()))) {
				fails.push("the tab has no focus, so no toast can show");
			}
			const needs = Number.parseInt(
				(await page.getByTestId("thread-section-needs-count").textContent()) ??
					"",
				10,
			);
			await expect(page)
				.toHaveTitle(new RegExp(`^\\(${needs}\\) `), { timeout: 10_000 })
				.catch(() => undefined);
			const title = await page.title();
			if (!title.startsWith(`(${needs}) `)) {
				fails.push(`tab title "${title}" lacks the needs-you count (${needs})`);
			}
			await expect.poll(() => armed.reads()).toBeGreaterThan(0);

			const ids = ["host.restart", "agent.runaway", "budget.cap"].map((c) =>
				threadId(sim, c),
			);
			await deliver(
				page,
				armed,
				ids.map((id, i) => needsEvent(i + 1, id)),
			);
			const toasts = page.getByTestId("attention-toast");
			await expect(toasts.first()).toBeVisible({ timeout: 10_000 });
			const shown = await toasts.count();
			if (shown !== 2) fails.push(`3 events showed ${shown} toasts, not 2`);

			await toasts.first().getByRole("button").first().click();
			await expect(page).toHaveURL(/\/threads\/[0-9a-f-]{36}/);
			const opened = new URL(page.url()).pathname.split("/").pop() ?? "";
			if (!ids.includes(opened)) {
				fails.push(`a toast click opened ${opened}, not an event's thread`);
			}

			await open("/events", "events-page");
			const list = page.getByTestId("event-list");
			await expect(list.getByRole("tab", { name: /Unread/i })).toBeVisible();
			await expect(list.getByRole("tab", { name: /All/i })).toBeVisible();
			await page.unrouteAll({ behavior: "ignoreErrors" });

			return verdict(
				fails,
				`tab title "${title}"; 3 events for other threads showed ${shown} toasts, a click opened thread ${opened.slice(0, 8)}; event list has Unread and All`,
			);
		},
	},
	{
		item: "4.4",
		async run({ page, open, sim }) {
			const armed = await arm(page);
			await open("/new", "new-thread-page");
			await page.bringToFront();
			const fails: string[] = [];
			const needs = Number.parseInt(
				(await page.getByTestId("thread-section-needs-count").textContent()) ??
					"",
				10,
			);
			await expect.poll(() => armed.reads()).toBeGreaterThan(0);
			await expect.poll(async () => (await armed.badge()).at(-1)).toBe(needs);

			const a = threadId(sim, "host.restart");
			const b = threadId(sim, "agent.runaway");
			const first = [needsEvent(1, a), needsEvent(2, a), needsEvent(3, b)];
			await deliver(page, armed, first);
			await expect.poll(async () => (await armed.notes()).length).toBe(3);
			const tags = (await armed.notes()).map((n) => n.tag);
			const want = [`thread-${a}`, `thread-${a}`, `thread-${b}`];
			if ([...tags].sort().join() !== [...want].sort().join()) {
				fails.push(`notification tags ${tags.join()} are not per thread`);
			}

			await armed.fireNote(tags.indexOf(`thread-${a}`));
			await expect(page).toHaveURL(new RegExp(`/threads/${a}`));
			const focused = await armed.fired();
			if (focused < 1)
				fails.push("a notification click did not focus the window");

			// Viewing thread a now: its next event stays silent, another thread's does not.
			const before = (await armed.notes()).length;
			await deliver(page, armed, [...first, needsEvent(4, a)]);
			const silent = (await armed.notes()).length === before;
			if (!silent)
				fails.push("an event for the thread on screen raised a notification");
			await deliver(page, armed, [
				...first,
				needsEvent(4, a),
				needsEvent(5, threadId(sim, "budget.cap")),
			]);
			const other = (await armed.notes()).length === before + 1;
			if (!other)
				fails.push("an event for another thread raised no notification");
			await page.unrouteAll({ behavior: "ignoreErrors" });

			return verdict(
				fails,
				`3 events for 2 threads raised ${want.length} notifications tagged per thread, a click focused the window and opened the thread; badge ${needs}; the viewed thread stayed silent`,
			);
		},
	},
	{
		item: "4.5",
		async run({ open }) {
			await open("/settings?tab=notifications", "settings-frame");
			const fails: string[] = [];

			const prefsBoth = {
				mode: "both" as const,
				events: { needsYou: true, finished: true, failed: true },
				when: "always" as const,
			};
			const prefsNotifOnly = {
				mode: "notifications" as const,
				events: { needsYou: true, finished: true, failed: true },
				when: "always" as const,
			};
			const tab = {
				focused: false,
				viewing: null,
				permission: "granted" as const,
			};

			const evNeeds = makeEvent({
				id: "1",
				threadId: "t1",
				kind: "needs_you",
				notify: true,
			});
			const evDone = makeEvent({
				id: "2",
				threadId: "t1",
				kind: "finished",
				notify: true,
			});
			const evFail = makeEvent({
				id: "3",
				threadId: "t1",
				kind: "failed",
				notify: true,
			});

			const soundOptIn = !decide(evNeeds, prefsNotifOnly, tab).sound;
			const soundNeeds = decide(evNeeds, prefsBoth, tab).sound;
			const soundDone = decide(evDone, prefsBoth, tab).sound;
			const soundFail = decide(evFail, prefsBoth, tab).sound;

			if (!soundOptIn)
				fails.push("sound played when mode is notifications only (not opt-in)");
			if (!soundNeeds)
				fails.push("sound not played for needs-you under both mode");
			if (soundDone)
				fails.push("sound played for finished event (must be needs-you only)");
			if (soundFail)
				fails.push("sound played for failed event (must be needs-you only)");

			return verdict(
				fails,
				`sound is opt-in (sound=${!soundOptIn} when mode=notifications); needs-you sound=${soundNeeds}; finished sound=${soundDone}; failed sound=${soundFail}`,
			);
		},
	},
	{
		item: "4.6",
		async run({ page, open }) {
			await open("/settings?tab=devices", "settings-frame");
			const fails: string[] = [];

			const rows = page.getByTestId("device-row");
			await expect(rows.first()).toBeVisible();
			const count = await rows.count();

			const revokeButtons = page.getByTestId("device-revoke");
			const revokeCount = await revokeButtons.count();

			// Test button on each device row
			const testButtons = rows.locator('button:has-text("Test")');
			const testCount = await testButtons.count();

			if (testCount < count) {
				fails.push(`${testCount} of ${count} device rows have a Test button`);
			}
			if (revokeCount < count) {
				fails.push(`${revokeCount} of ${count} device rows have Revoke`);
			}

			// Phone push backend opt-in under Devices
			const pushSection = page.locator(
				"text=/phone push|web push|push notifications/i",
			);
			const hasPush = (await pushSection.count()) > 0;
			if (!hasPush) {
				fails.push("Devices tab lacks phone push opt-in");
			}

			return verdict(
				fails,
				`${count} paired devices with ${revokeCount} Revoke buttons; ${testCount} Test buttons; phone push opt-in: ${hasPush}`,
			);
		},
	},
	{
		item: "4.7",
		async run({ page, open }) {
			// A turn of its own that stays running (the fake agent's live-stuck session).
			const made = await page.request.post("/api/incidents", {
				data: { title: "Bar check 4.7 running", tags: ["chat"] },
			});
			const { id } = (await made.json()) as { id: string };
			const started = await page.request.post(`/api/incidents/${id}/chat`, {
				data: { text: "Keep going fake-session:live-stuck" },
			});
			if (!started.ok())
				throw new Error(`start chat failed: ${await started.text()}`);
			const { investigationId } = (await started.json()) as {
				investigationId: string;
			};
			await open(`/threads/${investigationId}`, "thread-page");
			const followBtn = page.getByTestId("thread-follow");
			await expect(followBtn).toBeVisible();
			await followBtn.click();
			const watch = page.getByTestId("follow-watch");
			const mute = page.getByTestId("follow-mute");
			await expect(mute).toBeVisible();
			const watchText = (await watch.innerText()).trim();
			const muteText = (await mute.innerText()).trim();
			const disabled = (await watch.getAttribute("data-disabled")) !== null;
			await page.keyboard.press("Escape");
			const fails = [
				(watchText !== "Notify me when this finishes" || disabled) &&
					`on a running thread the watch item reads "${watchText}"${disabled ? " and is disabled" : ""}`,
				!/^Mute/.test(muteText) && `mute item reads "${muteText}"`,
			].filter((x): x is string => !!x);
			return verdict(
				fails,
				`a running thread's follow menu offers "${watchText}" (enabled) and "${muteText}"`,
			);
		},
	},
	{
		item: "4.8",
		async run({ page, open }) {
			await open("/settings?tab=notifications", "settings-frame");
			const fails: string[] = [];
			const list = page.getByTestId("notify-limits-list");
			await expect(list).toBeVisible();
			const items = await list.locator("li").allInnerTexts();

			const hasHttps = items.some((t) => t.includes("HTTPS"));
			const hasHomeScreen = items.some(
				(t) =>
					t.includes("Home Screen") ||
					t.includes("iOS") ||
					t.includes("iPhone"),
			);
			const hasLeaves = items.some(
				(t) => t.includes("no outside service") || t.includes("this instance"),
			);

			if (!hasHttps) fails.push("limits do not state HTTPS requirement");
			if (!hasHomeScreen)
				fails.push("limits do not state Home Screen on iOS requirement");
			if (!hasLeaves) fails.push("limits do not state what leaves the machine");

			return verdict(
				fails,
				`${items.length} stated limits: HTTPS, Home Screen on iPhone, and no outside service carries them`,
			);
		},
	},
]);
