#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Measures the huge-diff thread on the slow link (#1101 category 16 item 7), one cold browser
// per surface: time and bytes to the file tree, time to the first patch, the longest main-thread
// task while loading and while scrolling, DOM size, and the time to the connection word after a drop.
// Point --ui at a built UI (the API serving PRISMALENS_STATIC_DIR): a dev server's unbundled modules
// cost a round trip each on this link. Wrap it in a hard timeout; it prints one JSON line per surface.
// `--stamp` writes the huge.diff stamp (scripts/fakes/conditions/stamp.mjs) from the Changes pane.
//   PRISMALENS_WORKSPACE_DIR=<ws> node scripts/fakes/huge-diff-measure.mjs --ui http://127.0.0.1:3420 --thread <id> [--out <dir>] [--width 1440] [--fast] [--stamp]
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { slowLink } from "../../packages/frontend/e2e/journeys/slow-link.ts";
import { stampDir, writeStamp } from "./conditions/stamp.mjs";

const require = createRequire(
	new URL("../../packages/frontend/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");

function arg(name, dflt) {
	const i = process.argv.indexOf(name);
	return i > -1 ? process.argv[i + 1] : dflt;
}
const ui = arg("--ui", "http://127.0.0.1:3420").replace(/\/$/, "");
const thread = arg("--thread");
const out = arg("--out");
const width = Number(arg("--width", "1440"));
const fast = process.argv.includes("--fast");
const stamping = process.argv.includes("--stamp");
if (!thread) throw new Error("Pass --thread <id>");

/** True once any element matching `sel` exists, open shadow roots included. */
const deep = (sel) => `(() => {
	const walk = (r) => { for (const el of r.querySelectorAll("*")) { if (el.matches(${JSON.stringify(sel)})) return true; if (el.shadowRoot && walk(el.shadowRoot)) return true; } return false; };
	return walk(document);
})()`;

/** Ms from t0 until `expr` holds; survives the navigation it is timing. */
async function until(page, t0, expr, timeout = 90_000) {
	while (Date.now() - t0 < timeout) {
		try {
			if (await page.evaluate(expr)) return Date.now() - t0;
		} catch {
			// The page is between documents.
		}
		await page.waitForTimeout(50);
	}
	return null;
}

const ONLY = arg("--surface");
const SURFACES = [
	{
		name: "changes",
		path: `/threads/${thread}?panel=changes`,
		ready: deep("[data-item-path]"),
		first: deep(
			"[data-line], [data-testid=diff-load], [data-testid=diff-no-patch]",
		),
		scroll: ["[data-testid=diff-files]", "[data-testid=diff-patch]"],
	},
	{
		name: "files",
		path: `/threads/${thread}?panel=files`,
		ready: deep("[data-testid^=files-mode-], [data-testid=files-none]"),
		first: null,
		scroll: ["main"],
	},
	{
		name: "turn-card",
		path: `/threads/${thread}`,
		ready: deep("[data-testid=turn-changes]"),
		first: deep("[data-testid=turn-end]"),
		scroll: ["main"],
	},
];

const browser = await chromium.launch();
try {
	const viewport = { width, height: 900 };
	const pairing = await browser.newContext({ baseURL: ui, viewport });
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
		timeout: 60_000,
	});
	await p0.request.put("/api/settings/telemetry", {
		data: { noticed: true, dismissed: true },
	});
	const storageState = await pairing.storageState();
	await pairing.close();
	if (out) mkdirSync(out, { recursive: true });
	const rows = [];
	let files = null;

	for (const s of SURFACES.filter((x) => !ONLY || x.name === ONLY)) {
		// A cold cache each time: the bytes are what a first visit on this link pays.
		const context = await browser.newContext({
			baseURL: ui,
			viewport,
			storageState,
		});
		const page = await context.newPage();
		page.on("response", (r) => {
			if (!/\/changes\?.*patch=none/.test(r.url())) return;
			r.json()
				.then((d) => {
					files = d.repos.reduce((n, x) => n + (x.files?.length ?? 0), 0);
				})
				.catch(() => {});
		});
		const link = fast ? null : await slowLink(page);
		const bytesNow = () =>
			(link?.transfers() ?? []).reduce((n, t) => n + t.bytes, 0);
		const t0 = Date.now();
		await page.goto(s.path, { waitUntil: "commit" });
		const readyMs = await until(page, t0, s.ready);
		const bytesBeforeReady = bytesNow();
		const firstMs = s.first ? await until(page, t0, s.first) : null;
		await page.waitForTimeout(2000);
		const loadTask = link ? await link.longestTask() : null;
		await link?.resetTasks();
		const only = arg("--scroll");
		for (const sel of s.scroll.filter((x) => !only || x.includes(only))) {
			const box = await page
				.locator(sel)
				.first()
				.boundingBox()
				.catch(() => null);
			if (!box) continue;
			await page.mouse.move(
				box.x + box.width / 2,
				box.y + Math.min(80, box.height / 2),
			);
			// A fast flick: one 100 px wheel notch per frame, 6000 px in all.
			for (let i = 0; i < 60; i++) {
				await page.mouse.wheel(0, 100);
				await page.waitForTimeout(16);
			}
		}
		await page.waitForTimeout(1500);
		const scrollTask = link ? await link.longestTask() : null;
		if (process.argv.includes("--verbose"))
			console.log(
				"  scroll tasks:",
				await page.evaluate(() =>
					(globalThis.__plLongTasks ?? []).map((d) => Math.round(d)).join(" "),
				),
			);
		const changesApi = (link?.transfers() ?? [])
			.filter((t) => /\/api\/investigations\/[^/]+\/changes/.test(t.url))
			.map((t) => ({
				url: t.url.replace(/^.*\/changes/, "changes").slice(0, 60),
				bytes: t.bytes,
			}));
		let dropToWordMs = null;
		if (link && s.name === "changes") {
			const d0 = Date.now();
			const dropping = link.drop(10_000);
			dropToWordMs = await until(
				page,
				d0,
				"!!document.querySelector('[data-testid=reconnect-line], [data-testid=phone-connection]:not([data-state=connected])') || /Reconnecting|Connection lost/.test(document.body.innerText)",
				10_000,
			);
			await dropping;
		}
		const row = {
			surface: s.name,
			width,
			readyMs,
			bytesBeforeReady,
			firstMs,
			longestTaskLoadMs: loadTask === null ? null : Math.round(loadTask),
			longestTaskScrollMs: scrollTask === null ? null : Math.round(scrollTask),
			domNodes: link ? await link.domNodes() : null,
			bytes: bytesNow(),
			changesApi,
			dropToWordMs,
		};
		console.log(JSON.stringify(row));
		rows.push(row);
		if (process.argv.includes("--verbose"))
			for (const t of [...(link?.transfers() ?? [])]
				.sort((a, b) => b.bytes - a.bytes)
				.slice(0, 12))
				console.log(
					`  ${t.bytes}	${t.url.replace(/^.*\/(assets|api)\//, "$1/")}`,
				);
		if (out) {
			await page.waitForTimeout(link ? 3000 : 0);
			await page.screenshot({ path: join(out, `${s.name}-${width}.png`) });
		}
		if (stamping && s.name === "changes") {
			const shot = `huge.diff.changes-${width}.png`;
			mkdirSync(stampDir(), { recursive: true });
			await page.screenshot({ path: join(stampDir(), shot) });
			writeStamp({
				condition: "huge.diff",
				simulator: "seed.huge-diff",
				// The measure's ceiling is for scrolling; the load task is in the detail.
				observed: {
					files: files ?? Number.NaN,
					bytesBeforeFirstFile: row.bytesBeforeReady,
					longestTaskMs: row.longestTaskScrollMs ?? Number.NaN,
					// The registry's metric names, which `pnpm sim report` reads.
					"bytes.beforeFirstFile": row.bytesBeforeReady,
					"mainThread.longestTask": row.longestTaskScrollMs ?? Number.NaN,
					longestLoadTaskMs: row.longestTaskLoadMs ?? Number.NaN,
					treeMs: row.readyMs ?? Number.NaN,
					firstPatchMs: row.firstMs ?? Number.NaN,
					cpu: fast ? 1 : 4,
				},
				detail: { width, slowLink: !fast, rows },
				files: [shot],
				measures: [
					{
						metric: "bytes.beforeFirstFile",
						value: row.bytesBeforeReady ?? null,
						unit: "B",
						page: "changes",
					},
					{
						metric: "mainThread.longestTask",
						value: row.longestTaskScrollMs,
						unit: "ms",
						page: "changes",
					},
				],
			});
		}
		await context.close();
	}
} finally {
	await browser.close();
}
