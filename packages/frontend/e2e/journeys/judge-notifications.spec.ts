// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "../steps/fixtures";
import { visit, waitForRun } from "../steps/product";
import { hideQueryDevtools } from "./live-stream-fixtures";

/**
 * #1101 category 4 for judges: a headless browser shows no OS notification, so the page's
 * Notification and app badge are stubbed and every call is logged, then each logged
 * notification is drawn as a card. `pnpm sim judge-evidence` runs it beside the matrix.
 */
const OUT = resolve(process.env.DESIGN_SHOTS_DIR ?? "design-shots/matrix");

test.skip(!process.env.DESIGN_SHOTS, "design shots run on purpose only");
test.setTimeout(15 * 60_000);

interface Logged {
	os: { title: string; body?: string; tag?: string; at: number }[];
	badge: number[];
	titles: string[];
	focused: boolean;
}

/** Runs before any page script: the stubs, and a switch for the tab's focus. */
function stubs() {
	const w = window as unknown as { __plNotify: Logged };
	w.__plNotify = { os: [], badge: [], titles: [], focused: true };
	const log = w.__plNotify;
	class FakeNotification {
		static permission = "granted";
		static requestPermission = async () => "granted";
		onclick: (() => void) | null = null;
		constructor(title: string, opts: { body?: string; tag?: string } = {}) {
			log.os.push({ title, body: opts.body, tag: opts.tag, at: Date.now() });
		}
		close() {}
	}
	Object.defineProperty(window, "Notification", { value: FakeNotification });
	const nav = navigator as Navigator & {
		setAppBadge?: (n?: number) => Promise<void>;
		clearAppBadge?: () => Promise<void>;
	};
	nav.setAppBadge = async (n?: number) => {
		log.badge.push(n ?? 0);
	};
	nav.clearAppBadge = async () => {
		log.badge.push(0);
	};
	document.hasFocus = () => log.focused;
	Object.defineProperty(document, "visibilityState", {
		get: () => (log.focused ? "visible" : "hidden"),
	});
	new MutationObserver(() => {
		if (log.titles.at(-1) !== document.title) log.titles.push(document.title);
	}).observe(document.querySelector("title") ?? document.head, {
		subtree: true,
		childList: true,
		characterData: true,
	});
}

/** As switching to another app does: blur and a hidden tab, or focus back. */
const setFocus = (page: Page, on: boolean) =>
	page.evaluate((v) => {
		(window as unknown as { __plNotify: Logged }).__plNotify.focused = v;
		window.dispatchEvent(new Event(v ? "focus" : "blur"));
		document.dispatchEvent(new Event("visibilitychange"));
	}, on);

const logged = (page: Page) =>
	page.evaluate(() => (window as unknown as { __plNotify: Logged }).__plNotify);

/** Each logged OS notification as a desktop notification card, for a judge to look at. */
async function drawCards(page: Page, log: Logged, file: string) {
	const esc = (t = "") => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
	const cards = log.os
		.map(
			(n) =>
				`<div class="card"><div class="app">PrismaLens · ${esc(n.tag)}</div><div class="t">${esc(n.title)}</div><div class="b">${esc(n.body)}</div></div>`,
		)
		.join("");
	const other = await page.context().newPage();
	await other.setViewportSize({
		width: 420,
		height: 120 + 110 * log.os.length,
	});
	await other.setContent(
		`<style>body{margin:0;padding:16px;background:#1b1b1f;font:14px system-ui;color:#eee}.card{background:#2b2b31;border-radius:10px;padding:12px 14px;margin-bottom:10px;box-shadow:0 2px 8px #0008}.app{font-size:12px;color:#aaa}.t{font-weight:600;margin:4px 0}.b{color:#ccc}</style><div>${cards || '<div class="card"><div class="t">No OS notification was raised</div></div>'}</div>`,
	);
	await other.screenshot({ path: join(OUT, file) });
	await other.close();
}

test("notifications, the badge and the toast, logged", async ({
	page,
	agents,
}) => {
	mkdirSync(OUT, { recursive: true });
	await hideQueryDevtools(page);
	await page.addInitScript(stubs);
	agents.install(["claude-agent-acp"], "claude");
	await page.request.post("/api/settings/harness/check", {
		data: { id: "claude-code" },
	});
	await page.request.patch("/api/settings/harness", {
		data: { harness: "claude-code" },
	});
	const chat = async (text: string) => {
		const made = await page.request.post("/api/incidents", {
			data: { title: text, tags: ["chat"] },
		});
		const { id } = (await made.json()) as { id: string };
		const started = await page.request.post(`/api/incidents/${id}/chat`, {
			data: { text },
		});
		expect(started.ok(), await started.text()).toBe(true);
		return id;
	};
	/** Each width loads the page afresh, so each keeps its own log. */
	const runs: (Logged & { width: number; steps: string[] })[] = [];
	for (const size of [
		{ w: 1440, h: 900 },
		{ w: 390, h: 844 },
	]) {
		const steps: string[] = [];
		await page.setViewportSize({ width: size.w, height: size.h });
		await visit(page, "/new", "home");
		// What is there when the app opens is history; the next events are news.
		await page.waitForTimeout(1500);

		// In the app: another thread finishing is a toast.
		const done = await chat(`Summarise the cache config (${size.w})`);
		await waitForRun(page, done, (r) => r.status === "completed", "chat");
		const toast = page.getByTestId("attention-toast").first();
		const shown = await toast
			.waitFor({ timeout: 30_000 })
			.then(() => true)
			.catch(() => false);
		steps.push(
			`${size.w}: tab focused, a thread finished: toast ${shown ? "shown" : "NOT shown"}`,
		);
		await page.screenshot({
			path: join(OUT, `notify-toast-${size.w}-dark.png`),
			animations: "disabled",
		});

		// Away in another app: a finish and an ask raise OS notifications and the badge.
		await setFocus(page, false);
		const before = (await logged(page)).os.length;
		const finished = await chat(`Check the retry budget (${size.w})`);
		const asking = await chat(
			`Pick a rollout window fake-session:ask (${size.w})`,
		);
		await waitForRun(page, finished, (r) => r.status === "completed", "chat");
		await waitForRun(
			page,
			asking,
			(r) => !["pending", "queued", "starting"].includes(r.status),
			"ask",
		);
		await page
			.waitForFunction(
				(n) =>
					(window as unknown as { __plNotify: Logged }).__plNotify.os.length >=
					n + 2,
				before,
				{ timeout: 45_000 },
			)
			.catch(() => {});
		const away = await logged(page);
		steps.push(
			`${size.w}: tab hidden, a thread finished and one asked: ${away.os.length - before} OS notification(s), badge ${JSON.stringify(away.badge.slice(-3))}, title "${away.titles.at(-1) ?? ""}"`,
		);
		await drawCards(
			page,
			{ ...away, os: away.os.slice(before) },
			`notify-os-${size.w}-dark.png`,
		);
		await setFocus(page, true);
		await page.waitForTimeout(1000);
		await page.screenshot({
			path: join(OUT, `notify-back-${size.w}-dark.png`),
			animations: "disabled",
		});
		runs.push({ width: size.w, steps, ...(await logged(page)) });
		writeFileSync(
			join(OUT, "notifications.json"),
			`${JSON.stringify(runs, null, 2)}\n`,
		);
	}
});
