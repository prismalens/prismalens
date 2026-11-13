#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// net.slow-link's measure (#1101 category 12): through the throttling proxy, with the CPU slowed 4x,
// one cold browser per page: bytes on the wire before its first content, the time to it, and the
// longest start-up task. Then the time to the connection word after a silent drop (the proxy's
// `drop`) and after the device goes offline. `--stamp` writes the net.slow-link stamp.
//   PRISMALENS_WORKSPACE_DIR=<ws> node scripts/fakes/conditions/slow-link-measure.mjs --ui http://127.0.0.1:3330 --thread <id> [--width 1440] [--stamp]
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { slowLink } from "../../../packages/frontend/e2e/journeys/slow-link.ts";
import { arg, stateDir } from "./lib.mjs";
import { stampDir, writeStamp } from "./stamp.mjs";

const require = createRequire(
	new URL("../../../packages/frontend/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");

const ui = (arg("--ui") ?? "http://127.0.0.1:3330").replace(/\/$/, "");
const thread = arg("--thread");
const width = Number(arg("--width") ?? "1440");
const dropS = Number(arg("--drop") ?? "10");
const only = arg("--page");
if (!thread) throw new Error("Pass --thread <id>");

/** True once any element matching `sel` exists, open shadow roots included. */
const deep = (sel) => `(() => {
	const walk = (r) => { for (const el of r.querySelectorAll("*")) { if (el.matches(${JSON.stringify(sel)})) return true; if (el.shadowRoot && walk(el.shadowRoot)) return true; } return false; };
	return walk(document);
})()`;
/** The word any page shows once its streams are down: the line, the phone header or the dock. */
const WORD =
	"[...document.querySelectorAll('[data-testid=reconnect-line], [data-testid=connection-dock], [data-testid=phone-connection]:not([data-state=connected]):not([data-state=connecting])')].some((e) => e.checkVisibility())";

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

const PAGES = [
	{
		name: "home",
		path: "/",
		ready: "!!document.querySelector('[data-testid=new-thread-page]')",
	},
	{
		name: "thread",
		path: `/threads/${thread}`,
		ready: "!!document.querySelector('[data-testid=transcript-item]')",
	},
	{
		name: "diff",
		path: `/threads/${thread}?panel=changes`,
		ready: deep("[data-item-path]"),
	},
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
		timeout: 90_000,
	});
	await p0.request.put("/api/settings/telemetry", {
		data: { noticed: true, dismissed: true },
	});
	const storageState = await pairing.storageState();
	await pairing.close();

	const rows = [];
	for (const p of PAGES.filter((x) => !only || x.name === only)) {
		// A cold cache each time: the bytes are what a first visit on this link pays.
		const context = await browser.newContext({
			baseURL: ui,
			viewport,
			storageState,
		});
		const page = await context.newPage();
		const cpu = await slowLink(page, undefined, false);
		const t0 = Date.now();
		await page.goto(p.path, { waitUntil: "commit" });
		const firstContentMs = await until(page, t0, p.ready, 90_000);
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
		await page.waitForTimeout(2000);
		const startupTaskMs = Math.round(await cpu.longestTask());
		const row = {
			page: p.name,
			width,
			firstContentMs,
			bytesBeforeFirstPaint: bytes,
			scriptBytesBeforeFirstPaint: scripts,
			startupTaskMs,
			silentDropToWordMs: null,
			offlineToWordMs: null,
			backToConnectedMs: null,
		};
		if (p.name !== "diff" && !process.argv.includes("--no-drop")) {
			// Settle: the word must be gone before a drop is timed.
			await until(page, Date.now(), `!(${WORD})`, 20_000);
			const drop = proxyDrop(dropS);
			const d0 = await drop.dropped;
			row.silentDropToWordMs = await until(page, d0, WORD, dropS * 1000);
			await drop.back;
			const b0 = Date.now();
			row.backToConnectedMs = await until(page, b0, `!(${WORD})`, 30_000);
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
	if (process.argv.includes("--stamp")) {
		const max = (k) => Math.max(...rows.map((r) => r[k] ?? Number.NaN));
		writeStamp({
			condition: "net.slow-link",
			simulator: "net.throttle",
			observed: {
				...link.observed,
				drops: 1,
				cpu: 4,
				"thread.firstContent": rows.find((r) => r.page === "thread")
					?.firstContentMs,
				"bytes.beforeFirstPaint": max("bytesBeforeFirstPaint"),
				"connection.wordAfterDrop": max("silentDropToWordMs"),
				"connection.wordAfterOffline": max("offlineToWordMs"),
				startupTaskMs: max("startupTaskMs"),
			},
			detail: { ui, width, link: link.observed, rows },
			files: [`net.slow-link.thread-${width}.png`],
		});
	}
} finally {
	await browser.close();
}
