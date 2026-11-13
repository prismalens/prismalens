// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The performance and conditions report (#1101), read like a coverage report: a run's stamps
// against the registry's thresholds, written to sim-report/ as summary.json, index.html and
// summary.md. It exits 1 when an active condition's measure misses or is not tested. The
// thresholds live only in the registry's condition entries; this file holds none.
//   pnpm sim report [--stamps <dir>] [--out <dir>] [--base <dir|sha>]
//   pnpm sim report --compare <old-sha> <new-sha> [--profile p] [--only a,b] [--allow-noisy]
import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { cpuLoad } from "../../packages/@prismalens/registry/src/stamp.ts";
import { ROOT } from "./lib.mjs";

/** Above this busy share at the start, a run's numbers are noisy and never quoted. */
const MAX_LOAD_PCT = Number(process.env.SIM_MAX_LOAD_PCT ?? 25);
const HISTORY = join(ROOT, ".sim-history");

/**
 * @typedef {{ metric: string, max: number, unit?: string } | { state: string }} Measure
 * @typedef {{ id: string, status: string, measure: Measure[] }} Entry
 * @typedef {{ metric: string, value: number | null, unit?: string, page?: string }} StampMeasure
 * @typedef {{ condition: string, walk: string, sha: string, run: string, at: string, observed: Record<string, number>, env?: Record<string, any>, measures?: StampMeasure[] }} Stamp
 * @typedef {{ condition: string, page: string, metric: string, unit: string, max: number, value: number | null, result: "pass" | "fail" | "untested", base?: number | null, delta?: number | null }} Row
 * @typedef {{ version: 1, generated: string, commit: string | null, run: string | null, noisy: boolean, maxLoadPct: number, env: Record<string, any> | null, base: { commit: string | null } | null, totals: { pass: number, fail: number, untested: number, judged: number }, conditions: { id: string, status: string, rows: Row[], judged: string[] }[], ok: boolean }} Summary
 */

const opt = (/** @type {string[]} */ argv, /** @type {string} */ name) => {
	const i = argv.indexOf(name);
	return i > -1 ? argv[i + 1] : undefined;
};

/** Registry entries by id, through the registry's own CLI. @returns {Entry[]} */
function entries(/** @type {string} */ name) {
	const out = execFileSync(
		process.execPath,
		[
			"packages/@prismalens/registry/src/cli.ts",
			"--config",
			"packages/frontend/registry.config.json",
			"profile",
			name,
			"--json",
		],
		{ cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);
	return JSON.parse(out);
}

/** Every stamp in a run's stamp directory; detail and artifact files are skipped. @returns {Stamp[]} */
function readStamps(/** @type {string} */ dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.includes("__") && f.endsWith(".json"))
		.flatMap((f) => {
			try {
				const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
				return s.version === 1 && s.condition ? [s] : [];
			} catch {
				return [];
			}
		});
}

/** The conditions the run selected: its sheet's rows, else whatever its stamps name. */
function selected(/** @type {string} */ dir, /** @type {Stamp[]} */ stamps) {
	const sheet = join(dirname(dir), "sheet.json");
	if (existsSync(sheet)) {
		const rows = JSON.parse(readFileSync(sheet, "utf8")).rows ?? [];
		if (rows.length) return rows.map((/** @type {{ id: string }} */ r) => r.id);
	}
	const fromEnv = stamps.flatMap((s) => s.env?.conditions ?? []);
	return [
		...new Set(fromEnv.length ? fromEnv : stamps.map((s) => s.condition)),
	];
}

/** One condition's metric rows: per page where the stamps give pages, else run-wide; worst value wins. */
function rowsFor(/** @type {Entry} */ entry, /** @type {Stamp[]} */ stamps) {
	/** @type {Row[]} */
	const rows = [];
	for (const m of entry.measure) {
		if (!("metric" in m)) continue;
		const seen = stamps.flatMap((s) =>
			(
				s.measures ?? [
					{ metric: m.metric, value: s.observed?.[m.metric] ?? null },
				]
			).filter((x) => x.metric === m.metric),
		);
		const pages = [...new Set(seen.flatMap((x) => (x.page ? [x.page] : [])))];
		for (const page of pages.length ? pages : ["all"]) {
			const values = seen
				.filter((x) => (pages.length ? x.page === page : !x.page))
				.map((x) => x.value)
				.filter((v) => typeof v === "number" && Number.isFinite(v));
			const value = values.length ? Math.max(...values) : null;
			rows.push({
				condition: entry.id,
				page,
				metric: m.metric,
				unit: m.unit ?? "",
				max: m.max,
				value,
				result: value === null ? "untested" : value <= m.max ? "pass" : "fail",
			});
		}
	}
	return rows;
}

/** Builds the summary of one stamp directory, with deltas against `base` when given. */
export function summarize(
	/** @type {string} */ dir,
	/** @type {Summary | null} */ base = null,
	noisy = false,
) {
	const stamps = readStamps(dir);
	const ids = selected(dir, stamps);
	const known = new Map(entries("all").map((e) => [e.id, e]));
	for (const id of ids)
		if (!known.has(id)) for (const e of entries(id)) known.set(e.id, e);
	const conditions = ids.map((id) => {
		const entry = known.get(id);
		if (!entry) throw new Error(`no condition ${id} in the registry`);
		const mine = stamps.filter((s) => s.condition === id);
		const rows = rowsFor(entry, mine).map((r) => {
			const b = base?.conditions
				.find((c) => c.id === id)
				?.rows.find((x) => x.page === r.page && x.metric === r.metric);
			if (!b) return r;
			return {
				...r,
				base: b.value,
				delta: r.value !== null && b.value !== null ? r.value - b.value : null,
			};
		});
		const judged = entry.measure.flatMap((m) =>
			"state" in m ? [m.state] : [],
		);
		return { id, status: entry.status, rows, judged };
	});
	const all = conditions.flatMap((c) => (c.status === "active" ? c.rows : []));
	const count = (/** @type {Row["result"]} */ k) =>
		all.filter((r) => r.result === k).length;
	const loads = stamps.flatMap((s) =>
		typeof s.env?.loadPct === "number" ? [s.env.loadPct] : [],
	);
	const env = stamps.find((s) => s.env)?.env ?? null;
	const load = loads.length ? Math.max(...loads) : null;
	const commits = [...new Set(stamps.map((s) => s.sha))];
	/** @type {Summary} */
	const summary = {
		version: 1,
		generated: new Date().toISOString(),
		commit: commits.length === 1 ? commits[0] : commits.join(",") || null,
		run: stamps[0]?.run ?? null,
		noisy: noisy || (load !== null && load > MAX_LOAD_PCT),
		maxLoadPct: MAX_LOAD_PCT,
		env: env ? { ...env, loadPct: load } : null,
		base: base ? { commit: base.commit } : null,
		totals: {
			pass: count("pass"),
			fail: count("fail"),
			untested: count("untested"),
			judged: conditions.reduce((n, c) => n + c.judged.length, 0),
		},
		conditions,
		ok: count("fail") === 0 && count("untested") === 0,
	};
	return summary;
}

const fmt = (/** @type {number | null | undefined} */ v, unit = "") => {
	if (v === null || v === undefined) return "—";
	if (unit === "B")
		return Math.abs(v) >= 1024 ? `${Math.round(v / 1024)} KB` : `${v} B`;
	return `${Math.round(v)}${unit ? ` ${unit}` : ""}`;
};
const signed = (/** @type {number | null | undefined} */ v, unit = "") =>
	v === null || v === undefined ? "" : `${v > 0 ? "+" : ""}${fmt(v, unit)}`;
const MARK = { pass: "✓ pass", fail: "✗ fail", untested: "○ not tested" };

function header(/** @type {Summary} */ s) {
	const e = s.env;
	const m = e?.machine;
	return [
		["Commit", s.commit ?? "—"],
		["Base", s.base?.commit ?? "none"],
		["Machine", m ? `${m.cpu}, ${m.cores} cores, ${m.ramGb} GB, ${m.os}` : "—"],
		[
			"CPU load at start",
			e?.loadPct === null || e?.loadPct === undefined
				? "not sampled"
				: `${e.loadPct}% (noisy above ${s.maxLoadPct}%)`,
		],
		["Cache", e?.cache ?? "—"],
		[
			"Throttle",
			e?.throttle
				? Object.entries(e.throttle)
						.map(([k, v]) => `${k} ${v}`)
						.join(", ")
				: "none",
		],
		["Build", e?.mode ?? "—"],
		["Profile", `${e?.profile ?? "—"}: ${(e?.conditions ?? []).join(", ")}`],
		["Run", s.run ?? "—"],
	];
}

export function markdown(/** @type {Summary} */ s) {
	const t = s.totals;
	const verdict = s.noisy
		? "NOISY: the machine was busy; do not quote"
		: s.ok
			? "PASS"
			: "FAIL";
	const delta = s.base !== null;
	return `${[
		`### Conditions report: ${verdict}`,
		"",
		`${t.pass} pass · ${t.fail} fail · ${t.untested} not tested · ${t.judged} judged by review`,
		"",
		header(s)
			.map(([k, v]) => `- ${k}: ${v}`)
			.join("\n"),
		"",
		`| Condition | Page | Measure | Value | Threshold |${delta ? " Δ base |" : ""} Result |`,
		`|---|---|---|---|---|${delta ? "---|" : ""}---|`,
		...s.conditions.flatMap((c) =>
			c.rows.map(
				(r) =>
					`| ${c.id}${c.status === "active" ? "" : ` (${c.status})`} | ${r.page} | ${r.metric} | ${fmt(r.value, r.unit)} | ≤ ${fmt(r.max, r.unit)} |${delta ? ` ${signed(r.delta, r.unit)} |` : ""} ${MARK[r.result]} |`,
			),
		),
	].join("\n")}\n`;
}

const esc = (/** @type {string} */ t) =>
	String(t).replace(
		/[&<>"]/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
	);

export function html(/** @type {Summary} */ s) {
	const delta = s.base !== null;
	const verdict = s.noisy ? "noisy" : s.ok ? "pass" : "fail";
	const sections = s.conditions
		.map(
			(c) => `<section><h2>${esc(c.id)} <small>${esc(c.status)}</small></h2>
<table><tr><th>Page</th><th>Measure</th><th class=n>Value</th><th class=n>Threshold</th>${delta ? "<th class=n>Base</th><th class=n>Δ</th>" : ""}<th>Result</th></tr>
${c.rows
	.map(
		(r) =>
			`<tr><td>${esc(r.page)}</td><td>${esc(r.metric)}</td><td class=n>${esc(fmt(r.value, r.unit))}</td><td class=n>≤ ${esc(fmt(r.max, r.unit))}</td>${delta ? `<td class=n>${esc(fmt(r.base, r.unit))}</td><td class="n ${r.delta && r.delta > 0 ? "worse" : "better"}">${esc(signed(r.delta, r.unit))}</td>` : ""}<td class=${r.result}>${esc(MARK[r.result])}</td></tr>`,
	)
	.join("\n")}
${c.judged.map((j) => `<tr><td colspan=${delta ? 7 : 5}><span class=judged>◇ judged</span> ${esc(j)}</td></tr>`).join("\n")}
</table></section>`,
		)
		.join("\n");
	return `<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Conditions report</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--mute:#666;--line:#ddd;--pass:#1a7f37;--fail:#cf222e;--wait:#9a6700}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#e8e8e8;--mute:#999;--line:#333;--pass:#3fb950;--fail:#f85149;--wait:#d29922}}
body{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}small{color:var(--mute);font-weight:400}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 16px;margin:12px 0}dt{color:var(--mute)}dd{margin:0}
.tbl{overflow-x:auto}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left;white-space:nowrap}
.n{text-align:right;font-variant-numeric:tabular-nums}.pass{color:var(--pass)}.fail,.worse{color:var(--fail)}.untested,.noisy{color:var(--wait)}.judged{color:var(--mute)}
</style>
<h1>Conditions report: <span class=${verdict}>${esc(verdict.toUpperCase())}</span></h1>
<p>${s.totals.pass} pass · ${s.totals.fail} fail · ${s.totals.untested} not tested · ${s.totals.judged} judged by review</p>
<dl>${header(s)
		.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
		.join("")}</dl>
<div class=tbl>${sections}</div>
</html>
`;
}

/** Writes the three outputs and keeps the summary under its commit, for a later `--base <sha>`. */
function write(/** @type {Summary} */ s, /** @type {string} */ out) {
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	writeFileSync(
		join(out, "summary.json"),
		`${JSON.stringify(s, null, "\t")}\n`,
	);
	writeFileSync(join(out, "summary.md"), markdown(s));
	writeFileSync(join(out, "index.html"), html(s));
	if (s.commit && !s.commit.includes(",")) {
		mkdirSync(join(HISTORY, s.commit), { recursive: true });
		writeFileSync(
			join(HISTORY, s.commit, "summary.json"),
			`${JSON.stringify(s, null, "\t")}\n`,
		);
	}
}

/** A base is a report or stamps directory, or a commit whose summary an earlier report kept. */
function loadBase(/** @type {string} */ base) {
	const dir = resolve(base);
	if (existsSync(join(dir, "summary.json")))
		return JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
	if (existsSync(dir) && readStamps(dir).length) return summarize(dir);
	const hit = existsSync(HISTORY)
		? readdirSync(HISTORY).find((d) => d.startsWith(base) || base.startsWith(d))
		: undefined;
	if (hit)
		return JSON.parse(readFileSync(join(HISTORY, hit, "summary.json"), "utf8"));
	throw new Error(
		`no base at ${base}: pass a sim-report or stamps directory, or a commit an earlier report ran on (${HISTORY})`,
	);
}

/** Brings up each commit in turn with the same profile and keeps its stamps. */
async function compare(/** @type {string[]} */ argv) {
	const i = argv.indexOf("--compare");
	const [oldRef, newRef] = [argv[i + 1], argv[i + 2]];
	if (!oldRef || !newRef)
		throw new Error("--compare needs <old-sha> <new-sha>");
	const load = await cpuLoad(2000);
	const noisy = load > MAX_LOAD_PCT;
	if (noisy && !argv.includes("--allow-noisy")) {
		console.error(
			`[sim] refusing to compare: the CPU is ${load}% busy, above ${MAX_LOAD_PCT}%. Stop other runs, or pass --allow-noisy for a report marked noisy.`,
		);
		return 3;
	}
	const pass = ["--profile", "--only", "--mode"].flatMap((f) => {
		const v = opt(argv, f);
		return v ? [f, v] : [];
	});
	if (!pass.includes("--mode")) pass.push("--mode", "built");
	const sim = join(ROOT, "scripts/sim/sim.mjs");
	/** @type {Summary | null} */
	let base = null;
	let last = null;
	for (const ref of [oldRef, newRef]) {
		const stamps = join(HISTORY, ref, "stamps");
		try {
			execFileSync(
				process.execPath,
				[sim, "up", "--ref", ref, "--measure", ...pass],
				{
					cwd: ROOT,
					stdio: "inherit",
				},
			);
		} finally {
			execFileSync(process.execPath, [sim, "down"], {
				cwd: ROOT,
				stdio: "inherit",
			});
		}
		const tree = join(
			ROOT,
			".claude",
			"worktrees",
			`sim-${ref.replace(/[^\w.-]/g, "-")}`,
			".sim",
		);
		rmSync(stamps, { recursive: true, force: true });
		cpSync(join(tree, "stamps"), stamps, { recursive: true });
		if (existsSync(join(tree, "sheet.json")))
			cpSync(join(tree, "sheet.json"), join(HISTORY, ref, "sheet.json"));
		last = summarize(stamps, base, noisy);
		if (!base) base = last;
	}
	return /** @type {Summary} */ (last);
}

/** @returns {Promise<number>} the exit code */
export async function main(/** @type {string[]} */ argv) {
	const out = resolve(opt(argv, "--out") ?? join(ROOT, "sim-report"));
	let s;
	if (argv.includes("--compare")) {
		const r = await compare(argv);
		if (typeof r === "number") return r;
		s = r;
	} else {
		const stamps = resolve(
			opt(argv, "--stamps") ?? join(ROOT, ".sim", "stamps"),
		);
		const base = opt(argv, "--base");
		s = summarize(stamps, base ? loadBase(base) : null);
	}
	write(s, out);
	console.log(markdown(s));
	console.log(`[sim] report: ${join(out, "index.html")}`);
	return s.ok ? 0 : 1;
}
