// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// What `pnpm sim` and its control process share: running a stage or trigger line, finding
// the threads it printed, and the sheet a person reads (#1101).
import { execSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * @typedef {{ run: string, on: "schedule" | "button", atS?: number | "mid" }} Trigger
 * @typedef {{ id: string, ok: boolean, ms: number, links: string[], live: string, trigger?: Trigger, walks?: string[] }} Row
 * @typedef {{ profile: string, run: string, url: string, slowUrl: string | null, pair: string | null, pairCommand?: string, control: string, stamps: string, rows: Row[], upMs: number }} Sheet
 */

/** Runs a stage or trigger command line from the repo root; its output goes to `logFile`. */
export function runLine(
	/** @type {string} */ line,
	/** @type {Record<string, string | undefined>} */ env,
	/** @type {string} */ logFile,
	timeoutMs = 360_000,
) {
	const started = Date.now();
	let out = "";
	let ok = true;
	try {
		out = execSync(line, {
			windowsHide: true,
			cwd: ROOT,
			env,
			encoding: "utf8",
			timeout: timeoutMs,
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (e) {
		ok = false;
		const err =
			/** @type {{ stdout?: string, stderr?: string, message: string }} */ (e);
		out = `${err.stdout ?? ""}${err.stderr ?? ""}` || err.message;
	}
	appendFileSync(logFile, `$ ${line}\n${out}\n`);
	return { ok, out, ms: Date.now() - started };
}

/** The threads a stage printed, as links on `url`. */
export function liveLinks(
	/** @type {string} */ out,
	/** @type {string} */ url,
) {
	const ids = new Set([
		...Array.from(out.matchAll(/\/threads\/([0-9a-f-]{36})/g), (m) => m[1]),
		...Array.from(out.matchAll(/thread ([0-9a-f-]{36})/g), (m) => m[1]),
	]);
	return [...ids].map((id) => `${url}/threads/${id}`);
}

/** When a scheduled trigger fires, in seconds after `up`; "mid" is the middle of a walk. */
export const fireAtS = (/** @type {Trigger} */ t) =>
	t.atS === "mid" || t.atS === undefined
		? Number(process.env.SIM_MID_S ?? 300)
		: t.atS;

const triggerText = (/** @type {Trigger | undefined} */ t) =>
	!t
		? ""
		: t.on === "button"
			? "button on the control page"
			: `fires ${fireAtS(t)} s after up, and from the control page`;

/** The sheet as Markdown: where to open the app, and where each condition is live. */
export function renderSheet(/** @type {Sheet} */ s) {
	const pairCmd = s.pairCommand ?? "pnpm sim pair";
	const lines = [
		`# Simulated PrismaLens: profile ${s.profile}`,
		"",
		`- Through the slow link (walk here): ${s.slowUrl ?? "not in this profile"}`,
		`- Direct: ${s.url}`,
		`- Sign in once (one-time link): ${s.pair ?? `run \`${pairCmd}\``}`,
		`- Each judge or tester mints their own link: \`${pairCmd}\` from the repo root prints one for the slow link and one direct`,
		"- Drafts follow the operator across devices by design, so everyone on this server shares Home's draft. Give each judge their own sim (`PRISMALENS_SIM_DIR=.sim-<judge> pnpm sim up …`, own ports), or have them write drafts only in threads they started.",
		`- Control page (triggers): ${s.control}`,
		`- Stamps: ${s.stamps} (run ${s.run})`,
		`- Up took ${Math.round(s.upMs / 1000)} s`,
		"",
		"| Condition | Staged | Where it is live | Trigger |",
		"|---|---|---|---|",
		...s.rows.map(
			(r) =>
				`| ${r.id} | ${r.ok ? "yes" : "FAILED (see logs)"} | ${[...r.links, r.live].join("<br>")} | ${triggerText(r.trigger)} |`,
		),
	];
	return `${lines.join("\n")}\n`;
}

const esc = (/** @type {string} */ t) =>
	t.replace(
		/[&<>"]/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
	);

/** The control page: the sheet, with a button per trigger. */
export function renderHtml(
	/** @type {Sheet} */ s,
	/** @type {Record<string, string>} */ fired,
) {
	const link = (/** @type {string} */ u) => `<a href="${esc(u)}">${esc(u)}</a>`;
	const rows = s.rows
		.map(
			(r) =>
				`<tr><td>${esc(r.id)}</td><td>${r.ok ? "yes" : "FAILED"}</td><td>${[
					...r.links.map(link),
					esc(r.live),
				].join("<br>")}</td><td>${
					r.trigger
						? `<form method="post" action="/fire/${encodeURIComponent(r.id)}"><button>Fire</button></form>${esc(triggerText(r.trigger))}${fired[r.id] ? `<br><small>${esc(fired[r.id])}</small>` : ""}`
						: ""
				}</td></tr>`,
		)
		.join("\n");
	return `<!doctype html><meta charset="utf-8"><title>Simulated PrismaLens</title>
<style>body{font:14px system-ui;margin:16px}td,th{border:1px solid #888;padding:4px 8px;vertical-align:top}table{border-collapse:collapse}</style>
<h1>Simulated PrismaLens: profile ${esc(s.profile)}</h1>
<p>App ${link(s.url)}${s.slowUrl ? ` · slow link ${link(s.slowUrl)}` : ""}${s.pair ? ` · sign in once: ${link(s.pair)}` : ""}</p>
<table><tr><th>Condition</th><th>Staged</th><th>Where it is live</th><th>Trigger</th></tr>
${rows}</table>`;
}
