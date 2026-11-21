#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// net.slow-link's measure (#1101 category 12): through the throttling proxy, with the CPU slowed 4x,
// one cold browser per page: bytes on the wire before its first content, the time to it, and the
// longest start-up task. Then the time to the connection word after a silent drop (the proxy's
// `drop`) and after the device goes offline. `--census` adds the request census (#1181, census.mjs):
// each page's calls while it loads, idles and watches another thread's agent work, on the slow
// link and (`--direct`) without it; `--tabs` two tabs at once; `--pool` a fresh tab beside live ones.
// `--stamp` writes the net.slow-link stamp, each metric per page, for `pnpm sim report`.
//   PRISMALENS_WORKSPACE_DIR=<ws> node scripts/fakes/conditions/slow-link-measure.mjs --ui <slowUrl> --thread <id> [--width 1440] [--census 30 --runs 3 --direct <url> --tabs 2 --pool] [--stamp]
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
	SLOW_LINK,
	slowLink,
} from "../../../packages/frontend/e2e/journeys/slow-link.ts";
import {
	census,
	hideable,
	listLag,
	loadCensus,
	longLived,
	sharedComputes,
} from "./census.mjs";
import { arg, connect, retry, startThread, stateDir } from "./lib.mjs";
import { stampDir, writeStamp } from "./stamp.mjs";

const require = createRequire(
	new URL("../../../packages/frontend/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");

const ui = (arg("--ui") ?? "http://127.0.0.1:3330").replace(/\/$/, "");
const direct = arg("--direct")?.replace(/\/$/, "");
const thread = arg("--thread");
const width = Number(arg("--width") ?? "1440");
const dropS = Number(arg("--drop") ?? "10");
const only = arg("--page");
/** Seconds of each census window; 0 skips the census. */
const censusS = Number(arg("--census") ?? "0");
const runs = Number(arg("--runs") ?? "1");
const tabs = Number(arg("--tabs") ?? "0");
const pool = process.argv.includes("--pool");
const T0 = Date.now();
/** Where the probe's time goes, on stderr: a full census runs for most of an hour. */
const tick = (/** @type {string} */ what) =>
	console.error(`[${Math.round((Date.now() - T0) / 1000)} s] ${what}`);
if (!thread) throw new Error("Pass --thread <id>");

/** True once any element matching `sel` exists, open shadow roots included. */
const deep = (sel) => `(() => {
	const walk = (r) => { for (const el of r.querySelectorAll("*")) { if (el.matches(${JSON.stringify(sel)})) return true; if (el.shadowRoot && walk(el.shadowRoot)) return true; } return false; };
	return walk(document);
})()`;
/** The word any page shows once its streams are down: the line, the phone header or the dock. */
const WORD =
	"[...document.querySelectorAll('[data-testid=reconnect-line], [data-testid=connection-dock], [data-testid=phone-connection]:not([data-state=connected]):not([data-state=connecting])')].some((e) => e.checkVisibility())";

/** The interface font drawing: Plex loaded, not its fallback. */
const PLEX =
	"[...document.fonts].some((f) => f.family.includes('IBM Plex Sans Variable') && f.status === 'loaded')";

/** Sums every layout shift without recent input, from before any page script runs. */
function watchShifts() {
	globalThis.__plShift = 0;
	try {
		new PerformanceObserver((list) => {
			for (const e of list.getEntries())
				if (!e.hadRecentInput) globalThis.__plShift += e.value;
		}).observe({ type: "layout-shift", buffered: true });
	} catch {
		// No layout-shift timing in this browser: reads 0.
	}
}

/** Ms from t0 until `expr` holds; survives the navigation it is timing. */
async function until(page, t0, expr, timeout = 60_000) {
	while (Date.now() - t0 < timeout) {
		try {
			if (await page.evaluate(expr)) return Date.now() - t0;
		} catch {
			// Between documents.
		}
		await page.waitForTimeout(25);
	}
	return null;
}

const HOME = "!!document.querySelector('[data-testid=new-thread-page]')";
const TRANSCRIPT = "!!document.querySelector('[data-testid=transcript-item]')";
const SETTINGS = "!!document.querySelector('[data-testid=settings-frame]')";
const PAGES = [
	{ name: "home", path: "/", ready: HOME, census: true },
	{
		name: "thread",
		path: `/threads/${thread}`,
		ready: TRANSCRIPT,
		census: true,
	},
	{
		name: "diff",
		path: `/threads/${thread}?panel=changes`,
		ready: deep("[data-item-path]"),
		census: false,
	},
	// Census only: Settings has no first-paint bar of its own.
	...(censusS > 0
		? [{ name: "settings", path: "/settings", ready: SETTINGS, census: true }]
		: []),
];

/** Runs the proxy's `drop` and resolves with the moment the link went silent. */
function proxyDrop(forS) {
	const child = spawn(
		process.execPath,
		[
			join(import.meta.dirname, "slow-link-proxy.mjs"),
			"drop",
			"--for",
			String(forS),
		],
		{ env: process.env, stdio: ["ignore", "pipe", "inherit"] },
	);
	let out = "";
	const dropped = new Promise((resolve, reject) => {
		child.stdout.on("data", (c) => {
			out += c;
			if (/Link dropped/.test(out)) resolve(Date.now());
		});
		child.on("exit", (code) =>
			code ? reject(new Error(`drop exited ${code}:\n${out}`)) : undefined,
		);
	});
	const back = new Promise((r) => child.on("exit", () => r(undefined)));
	return { dropped, back };
}

const proxyState = join(stateDir("slow-link"), "state.json");
const link = existsSync(proxyState)
	? JSON.parse(readFileSync(proxyState, "utf8"))
	: null;
if (!link) throw new Error("No slow link is up; run slow-link-proxy.mjs up.");

/** `base` on a plain-HTTP name: not a secure context, as Tailscale over HTTP is not (#1181). */
const plain = (base) =>
	base.replace(/\/\/(127\.0\.0\.1|localhost)/, "//pl.test");

/** A signed-in browser state for `base`: the device cookie is per origin. */
async function signIn(browser, base, viewport) {
	const pairing = await browser.newContext({ baseURL: base, viewport });
	const p0 = await pairing.newPage();
	await p0.goto("/");
	const pair = execSync(
		"pnpm --silent --filter prismalens dev pair --operator",
		{ encoding: "utf8", env: process.env },
	);
	const token = pair.match(/\/pair#([^\s#]+)/)?.[1];
	if (!token) throw new Error(`No pairing link in:\n${pair}`);
	await p0.goto(`/pair#${token}`);
	await p0.waitForURL((u) => !u.pathname.startsWith("/pair"), {
		timeout: 90_000,
	});
	// From the page: Playwright's request API ignores the browser's pl.test mapping.
	await p0.evaluate(() =>
		fetch("/api/settings/telemetry", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ noticed: true, dismissed: true }),
		}),
	);
	const state = await pairing.storageState();
	await pairing.close();
	return state;
}

/** A thread whose fake agent works ten calls a second, reporting usage, until cancelled: a busy box. */
async function runaway(base, title = "Census load") {
	// Through the direct link when there is one: the slow link may be mid-drop.
	const { api } = await retry(() => connect(direct ?? base));
	const at = Date.now();
	// Never retried: a second create would leave the first load running beside it.
	const id = await startThread(api, "census-load", title);
	return {
		id,
		at,
		// A run that already ended answers 409; any other failure fails the probe, never a census.
		stop: () =>
			retry(() =>
				api(`/investigations/${id}/cancel`, {
					method: "POST",
					body: {},
					ok: [409],
				}),
			),
	};
}

/**
 * The idle window, then `runs` live windows while a runaway works, each with the list's lag.
 * `load` given: the views already watch that running thread (thread.live), so no idle window.
 * @param {{ page: import("@playwright/test").Page, cpu: import("../../../packages/frontend/e2e/journeys/slow-link.ts").SlowLinkHandle }[]} views
 */
async function liveCensus(base, views, given) {
	const ms = censusS * 1000;
	let idle = null;
	if (!given) {
		for (const v of views) v.cpu.resetRequests();
		await views[0].page.waitForTimeout(ms);
		idle = views.map((v) => census(v.cpu.requests(), ms));
	}
	tick("census: idle done");
	const load = given ?? (await runaway(base));
	tick("census: load started");
	// The new thread's row must reach the list before its lag means anything.
	await Promise.all(
		views.map((v) =>
			v.page
				.waitForSelector(`[data-testid=thread-row][data-id="${load.id}"]`, {
					timeout: 30_000,
				})
				.catch(() => undefined),
		),
	);
	tick("census: row seen");
	await views[0].page.waitForTimeout(3000);
	const live = [];
	let computes = null;
	let missShare = null;
	let connections = 0;
	try {
		for (let i = 0; i < runs; i++) {
			for (const v of views) v.cpu.resetRequests();
			const from = Date.now();
			const lags = await Promise.all(
				views.map((v) => listLag(v.page, load.id, ms, load.at)),
			);
			const logs = views.map((v) => v.cpu.requests());
			// A last lag sample can run past the window: rates divide by the time actually logged.
			const took = Date.now() - from;
			const shared = sharedComputes(logs, took);
			if (shared.perMin !== null) {
				computes = Math.max(computes ?? 0, shared.perMin);
				missShare = Math.max(missShare ?? 0, shared.missShare ?? 0);
			}
			connections = Math.max(connections, longLived(logs));
			live.push(
				views.map((v, j) => ({ ...census(logs[j], took), listLag: lags[j] })),
			);
		}
	} finally {
		if (!given) await load.stop();
		tick("census: live done");
	}
	// Past the stopped thread's last edge (10 s), so its hint never lands in the next page's load.
	await new Promise((r) => setTimeout(r, given ? 2000 : 12_000));
	return { idle, live, computes, missShare, connections };
}

/** thread.live: the page watches the runaway itself, as a person watching their own agent does. */
async function liveThreadCensus(browser, base, storageState, suffix = "") {
	const load = await runaway(base);
	const context = await browser.newContext({
		baseURL: base,
		viewport: { width, height: 900 },
		storageState,
	});
	try {
		const page = await context.newPage();
		const cpu = await slowLink(page, undefined, false);
		await page.goto(`/threads/${load.id}`, { waitUntil: "commit" });
		await until(page, Date.now(), TRANSCRIPT, 90_000);
		// The page settles as every other page's idle window lets it: its load is the load census's.
		await page.waitForTimeout(censusS * 1000);
		const c = await liveCensus(base, [{ page, cpu }], load);
		return {
			page: `thread.live${suffix}`,
			live: c.live.map((r) => r[0]),
			connections: c.connections,
			// The page watching a runaway agent: how long its main thread stayed busy at once.
			longestTaskMs: Math.round(await cpu.longestTask()),
		};
	} finally {
		await context.close();
		await load.stop();
		await new Promise((r) => setTimeout(r, 12_000));
	}
}

/** Opens `p` cold in its own context; first paint, then the census when asked. */
async function measurePage(browser, base, storageState, p, suffix = "") {
	const context = await browser.newContext({
		baseURL: base,
		viewport: { width, height: 900 },
		storageState,
	});
	const page = await context.newPage();
	const cpu = await slowLink(page, undefined, false);
	await page.addInitScript(watchShifts);
	const t0 = Date.now();
	await page.goto(p.path, { waitUntil: "commit" });
	tick(`${p.name}${suffix}: open`);
	const firstContentMs = await until(page, t0, p.ready, 90_000);
	tick(`${p.name}${suffix}: first content`);
	const bytes = cpu.transfers().reduce((n, t) => n + t.bytes, 0);
	const scripts = cpu
		.transfers()
		.filter((t) => /\.js(\?|$)/.test(t.url))
		.reduce((n, t) => n + t.bytes, 0);
	if (process.argv.includes("--verbose"))
		for (const t of cpu
			.transfers()
			.sort((a, b) => b.bytes - a.bytes)
			.slice(0, Number(process.env.TOPN ?? 25)))
			console.log(
				`  ${t.bytes}\t${t.url.replace(/^.*\/(assets|api)\//, "$1/")}`,
			);
	// The interface font arrives after the first paint; its swap is inside this wait.
	const fontMs = await until(page, t0, PLEX, firstContentMs + 10_000);
	await page.waitForTimeout(1000);
	const layoutShift = await page.evaluate(() => globalThis.__plShift ?? 0);
	const startupTaskMs = Math.round(await cpu.longestTask());
	const row = {
		page: p.name + suffix,
		width,
		firstContentMs,
		bytesBeforeFirstPaint: bytes,
		scriptBytesBeforeFirstPaint: scripts,
		startupTaskMs,
		fontMs,
		layoutShift: Math.round(layoutShift * 1000) / 1000,
		load: null,
		idle: null,
		live: null,
		silentDropToWordMs: null,
		dropToSilentMs: null,
		silentToWordMs: null,
		offlineToWordMs: null,
		backToConnectedMs: null,
	};
	if (censusS > 0) {
		// Load: every API call from navigation until the page settles.
		await page.waitForTimeout(3000);
		// A page that never showed content has no load to count, only the wait.
		if (firstContentMs !== null) row.load = loadCensus(cpu.requests(), base);
		if (p.census) {
			const c = await liveCensus(base, [{ page, cpu }]);
			row.idle = c.idle[0];
			row.live = c.live.map((r) => r[0]);
		}
	}
	return { row, page, context };
}

/** Times the connection word on `page` after a silent proxy drop. */
async function dropWord(page, during) {
	// Settle: the word must be gone before a drop is timed.
	await until(page, Date.now(), `!(${WORD})`, 20_000);
	// In the page: when the word commits, beside the mark the silence watch leaves when it
	// fires, so the 2 s splits into detection and render.
	await page.evaluate(`(() => {
		performance.clearMarks("pl:stream-silent");
		performance.clearMarks("pl:live-leader");
		performance.clearMarks("pl:live-reset");
		globalThis.__plWord = null;
		const seen = () => { if (globalThis.__plWord === null && (${WORD})) globalThis.__plWord = performance.timeOrigin + performance.now(); };
		new MutationObserver(seen).observe(document, { subtree: true, childList: true, attributes: true });
	})()`);
	const drop = proxyDrop(dropS);
	const d0 = await drop.dropped;
	const happened = during?.();
	const wordMs = await until(page, d0, WORD, dropS * 1000);
	const at = await page.evaluate(`(() => {
		const m = performance.getEntriesByName("pl:stream-silent")[0];
		return { fired: m ? performance.timeOrigin + m.startTime : null, word: globalThis.__plWord };
	})()`);
	await drop.back;
	const b0 = Date.now();
	const backMs = await until(page, b0, `!(${WORD})`, 30_000);
	return {
		happened: await happened,
		wordMs,
		dropToSilentMs: at.fired && Math.round(at.fired - d0),
		silentToWordMs: at.fired && at.word && Math.round(at.word - at.fired),
		backMs,
		resets: await page.evaluate(
			() => performance.getEntriesByName("pl:live-reset").length,
		),
		leaderPosts: await page.evaluate(
			() => performance.getEntriesByName("pl:live-leader").length,
		),
	};
}

/** `--tabs n`: n tabs in one browser on the thread, the census on all at once, then a drop on the last. */
async function tabsCensus(browser) {
	const base = plain(ui);
	const storageState = await signIn(browser, base, { width, height: 900 });
	const context = await browser.newContext({
		baseURL: base,
		viewport: { width, height: 900 },
		storageState,
	});
	const views = [];
	for (let i = 0; i < tabs; i++) {
		const page = await context.newPage();
		const cpu = await slowLink(page, undefined, false);
		await page.goto(`/threads/${thread}`, { waitUntil: "commit" });
		await until(page, Date.now(), TRANSCRIPT, 90_000);
		views.push({ page, cpu });
	}
	await insecure(views[0].page);
	await views[0].page.waitForTimeout(3000);
	const c = await liveCensus(base, views);
	const drop = await dropWord(views.at(-1).page);
	await until(views[0].page, Date.now(), `!(${WORD})`, 30_000);
	const resumeShowsMs = await resumeProbe(base, views);
	const handoffShowsMs = await handoffProbe(base, views);
	await context.close();
	return { ...c, drop, resumeShowsMs, handoffShowsMs };
}

/** Resume (#1181): a thread made and ended during a short drop shows in every tab once the stream is back. */
async function resumeProbe(base, views) {
	// Shorter than the 10 s fallback poll, so only the stream's replay can bring the row in time.
	const drop = proxyDrop(RESUME_DROP_S);
	await drop.dropped;
	await views[0].page.waitForTimeout(2000);
	const made = await runaway(base, "Resume probe");
	await made.stop();
	await drop.back;
	const each = await Promise.all(
		views.map(async ({ page, cpu }) => {
			await until(page, Date.now(), `!(${WORD})`, 30_000);
			const connected = Date.now();
			const ms = await until(page, connected, row(made.id), 30_000);
			return { ms, log: cpu.requests() };
		}),
	);
	// The stream attempt that came back: any tab's last one sent before the row showed.
	const path = (r) => new URL(r.url).pathname;
	const streamAt = Math.max(
		0,
		...each
			.flatMap((e) => e.log)
			.filter((r) => path(r) === "/api/live/changes" && r.at >= made.at)
			.map((r) => r.at),
	);
	// A feed read sent while down, before that attempt, that lands with the row is a poll, not the replay.
	const polled = each.some((e) =>
		e.log.some(
			(r) =>
				path(r) === "/api/threads/feed" && r.at >= made.at && r.at < streamAt,
		),
	);
	resumeDetail = {
		polled,
		each: each.map((e) => e.ms),
		streamAt,
		madeAt: made.at,
	};
	return polled || each.some((e) => e.ms === null)
		? 30_000
		: Math.max(...each.map((e) => e.ms));
}

/** Why resumeShowsMs read what it did. */
let resumeDetail = null;

/** Handoff (#1181): close the tab holding the stream; another takes it and still hears a new thread. */
async function handoffProbe(base, views) {
	const roles = await Promise.all(
		views.map(({ page }) =>
			page.evaluate(() => globalThis.__plLiveRole ?? null),
		),
	);
	// No roles: one stream per tab, so any tab will do.
	const at = Math.max(0, roles.indexOf("leader"));
	const closedAt = Date.now();
	await views[at].page.close({ runBeforeUnload: true });
	const rest = views.filter((_, i) => i !== at);
	const made = await runaway(base, "Handoff probe");
	const t0 = Date.now();
	const each = await Promise.all(
		rest.map(async ({ page }) => {
			const ms = (await until(page, t0, row(made.id), 30_000)) ?? 30_000;
			return { page, ms };
		}),
	);
	await made.stop();
	if (roles.includes("leader")) {
		// The row must come through a new leader, not a tab that kept its own stream.
		const took = await Promise.all(
			rest.map(({ page }) =>
				page.evaluate(
					(after) =>
						performance
							.getEntriesByName("pl:live-leader")
							.some((m) => performance.timeOrigin + m.startTime >= after),
					closedAt,
				),
			),
		);
		if (!took.some(Boolean)) return 30_000;
	}
	return Math.max(...each.map((e) => e.ms));
}

const RESUME_DROP_S = 5;

const row = (id) =>
	`!!document.querySelector('[data-testid=thread-row][data-id="${id}"]')`;

/** The multi-tab proof means nothing on a secure origin: abort rather than pass untested. */
async function insecure(page) {
	const ok = await page.evaluate(
		() => !isSecureContext && typeof BroadcastChannel === "function",
	);
	if (!ok) throw new Error("origin is secure; the plain-HTTP path is untested");
}

/** `--pool`: a fresh tab's Settings beside `n` tabs on a live thread over plain HTTP, `hide` of them hidden. */
async function poolProbe(browser, storageState, n, hide) {
	const load = await runaway(direct);
	const context = await browser.newContext({
		baseURL: plain(direct),
		viewport: { width, height: 900 },
		storageState,
	});
	try {
		const pages = [];
		const logs = [];
		for (let i = 0; i < n; i++) {
			const page = await context.newPage();
			if (i < hide) await page.addInitScript(hideable);
			const cpu = await slowLink(page, { ...SLOW_LINK, cpuRate: 1 }, false);
			logs.push(cpu);
			// A full connection pool is the defect itself: the tab never loads, and neither will Settings.
			const opened = await page
				.goto(`/threads/${load.id}`, { timeout: 30_000 })
				.then(() => until(page, Date.now(), TRANSCRIPT, 60_000))
				.catch(() => null);
			if (opened === null)
				return {
					ms: 30_000,
					connections: longLived(logs.map((l) => l.requests())),
				};
			pages.push(page);
		}
		await insecure(pages[0]);
		for (const page of pages.slice(0, hide))
			await page.evaluate(() => globalThis.__plHide());
		await pages[0]?.waitForTimeout(hide ? 6000 : 3000);
		const connections = longLived(logs.map((l) => l.requests()));
		const fresh = await context.newPage();
		const t0 = Date.now();
		let ms = 30_000;
		try {
			await fresh.goto("/settings", { waitUntil: "commit", timeout: 30_000 });
			ms = (await until(fresh, t0, SETTINGS, 30_000)) ?? 30_000;
		} catch {
			// Never committed: the pool is full.
		}
		return { ms, connections };
	} finally {
		await context.close();
		await load.stop();
	}
}

// pl.test: a plain-HTTP name for the multi-tab blocks; the app must allow it (PRISMALENS_ALLOWED_HOSTS).
const browser = await chromium.launch({
	args: ["--host-resolver-rules=MAP pl.test 127.0.0.1"],
});
try {
	const viewport = { width, height: 900 };
	const storageState = await signIn(browser, ui, viewport);
	const rows = [];
	for (const p of PAGES.filter((x) => !only || x.name === only)) {
		const { row, page, context } = await measurePage(
			browser,
			ui,
			storageState,
			p,
		);
		if (p.name !== "diff" && !process.argv.includes("--no-drop")) {
			tick(`${p.name}: drop`);
			const d = await dropWord(page);
			tick(`${p.name}: drop done`);
			row.silentDropToWordMs = d.wordMs;
			row.dropToSilentMs = d.dropToSilentMs;
			row.silentToWordMs = d.silentToWordMs;
			row.backToConnectedMs = d.backMs;
			await until(page, Date.now(), `!(${WORD})`, 20_000);
			const o0 = Date.now();
			await context.setOffline(true);
			row.offlineToWordMs = await until(page, o0, WORD, 10_000);
			await page.waitForTimeout(2000);
			await context.setOffline(false);
		}
		console.log(JSON.stringify(row));
		rows.push(row);
		if (p.name === "thread" && process.argv.includes("--stamp")) {
			mkdirSync(stampDir(), { recursive: true });
			await page.screenshot({
				path: join(stampDir(), `net.slow-link.thread-${width}.png`),
			});
		}
		await context.close();
	}

	if (censusS > 0 && (!only || only === "thread")) {
		const row = await liveThreadCensus(browser, ui, storageState);
		console.log(JSON.stringify(row));
		rows.push(row);
	}
	const directRows = [];
	if (censusS > 0 && direct) {
		const directState = await signIn(browser, direct, viewport);
		for (const p of PAGES.filter(
			(x) => x.census && (!only || x.name === only),
		)) {
			const { row, context } = await measurePage(
				browser,
				direct,
				directState,
				p,
				".direct",
			);
			console.log(JSON.stringify(row));
			directRows.push(row);
			await context.close();
		}
		if (!only || only === "thread") {
			const row = await liveThreadCensus(
				browser,
				direct,
				directState,
				".direct",
			);
			console.log(JSON.stringify(row));
			directRows.push(row);
		}
		if (pool) {
			const plainState = await signIn(browser, plain(direct), viewport);
			const pools = {
				"pool3.direct": await poolProbe(browser, plainState, 3, 0),
				"pool5h.direct": await poolProbe(browser, plainState, 5, 4),
			};
			console.log(JSON.stringify({ pools }));
			directRows.push({ page: "pools", pools });
		}
	}
	const tabRun = censusS > 0 && tabs > 1 ? await tabsCensus(browser) : null;
	if (tabRun) console.log(JSON.stringify({ tabs: tabRun }));

	if (process.argv.includes("--stamp")) {
		const bar = rows.filter(
			(r) => "firstContentMs" in r && r.page !== "settings",
		);
		// The diff page runs no drop; a page that did and never showed the word leaves the field out.
		const max = (k) =>
			Math.max(
				...bar
					.filter(
						(r) => !/(Drop|offline|Connected)/.test(k) || r.page !== "diff",
					)
					.map((r) => r[k] ?? Number.NaN),
			);
		const censusRows = [...rows, ...directRows].filter((r) => r.load || r.live);
		writeStamp({
			condition: "net.slow-link",
			simulator: "net.throttle",
			observed: {
				...link.observed,
				drops: 1,
				cpu: 4,
				"thread.firstContent": bar.find((r) => r.page === "thread")
					?.firstContentMs,
				"bytes.beforeFirstPaint": max("bytesBeforeFirstPaint"),
				"connection.wordAfterDrop": max("silentDropToWordMs"),
				"connection.wordAfterOffline": max("offlineToWordMs"),
				startupTaskMs: max("startupTaskMs"),
			},
			detail: {
				ui,
				direct,
				width,
				link: link.observed,
				rows,
				directRows,
				tabs: tabRun,
				resetsAfterDrop: tabRun?.drop.resets ?? null,
				leaderPostsDuringDrop: tabRun?.drop.leaderPosts ?? null,
				sharedMissShare: tabRun?.missShare ?? null,
				resume: resumeDetail,
			},
			files: [`net.slow-link.thread-${width}.png`],
			// One row per page (and per live run) in `pnpm sim report`; the diff page runs no drop.
			measures: [
				...bar.flatMap((r) => [
					{
						metric: "thread.firstContent",
						value: r.firstContentMs,
						unit: "ms",
						page: r.page,
					},
					{
						metric: "bytes.beforeFirstPaint",
						value: r.bytesBeforeFirstPaint,
						unit: "B",
						page: r.page,
					},
					...(r.page === "diff"
						? []
						: [
								{
									metric: "connection.wordAfterDrop",
									value: r.silentDropToWordMs,
									unit: "ms",
									page: r.page,
								},
							]),
				]),
				...censusRows.flatMap((r) => [
					...(r.load
						? [
								{
									metric: "load.duplicateFetches",
									value: r.load.duplicateFetches,
									page: r.page,
								},
							]
						: []),
					...(r.live ?? []).flatMap((l) => liveMeasures(l, r.page)),
					...(r.connections != null && !r.page.endsWith(".direct")
						? [
								{
									metric: "census.longLivedConnections",
									value: r.connections,
									page: r.page,
								},
							]
						: []),
				]),
				...(tabRun
					? [
							...tabRun.live.flatMap((run) =>
								run.flatMap((l, i) => liveMeasures(l, `thread.tab${i + 1}`)),
							),
							{
								metric: "census.longLivedConnections",
								value: tabRun.connections,
								page: "thread.tabs",
							},
							{
								metric: "census.sharedComputesPerMin",
								value: tabRun.computes,
								unit: "/min",
								page: "thread.tabs",
							},
							{
								metric: "census.resumeShowsMs",
								value: tabRun.resumeShowsMs,
								unit: "ms",
								page: "thread.tabs",
							},
							{
								metric: "census.handoffShowsMs",
								value: tabRun.handoffShowsMs,
								unit: "ms",
								page: "thread.tabs",
							},
							{
								metric: "connection.wordAfterDrop",
								value: tabRun.drop.wordMs,
								unit: "ms",
								page: `thread.tab${tabs}`,
							},
						]
					: []),
				...directRows
					.filter((r) => r.pools)
					.flatMap((r) =>
						Object.entries(r.pools).flatMap(([page, v]) => [
							{
								metric: "census.poolSettingsMs",
								value: v.ms,
								unit: "ms",
								page,
							},
							{
								metric: "census.longLivedConnections",
								value: v.connections,
								page,
							},
						]),
					),
			],
		});
	}
} finally {
	await browser.close();
}

/** One live window's rows: requests and bytes a minute, and the list's p95 lag. */
function liveMeasures(l, page) {
	return [
		{ metric: "census.liveRequestsPerMin", value: l.requestsPerMin, page },
		{
			metric: "census.liveApiBytesPerMin",
			value: l.apiBytesPerMin,
			unit: "B",
			page,
		},
		{ metric: "census.listLagMs", value: l.listLag.p95, unit: "ms", page },
	];
}
