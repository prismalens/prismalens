// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The bar checks (#1101 Scores, "Bar checks take the testing off the judges"): every checked
// bar item run by e2e/bar on a sim with every condition, every static item by vitest on the
// registry, both written into checks.md. `pnpm sim judge-evidence` runs it after the matrix.
//   pnpm sim bar-checks [--out <dir>] [--sim <running sim dir>] [--only 1,7] [--fast]
//                       [--timeout-min 90] [--report-only] [--no-build]
import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { ROOT } from "./lib.mjs";

const FRONTEND = join(ROOT, "packages/frontend");
const log = (/** @type {string} */ m) => console.log(`[bar-checks] ${m}`);
const sleep = (/** @type {number} */ ms) =>
	new Promise((r) => setTimeout(r, ms));

/** @param {string[]} argv @param {string} name */
const opt = (argv, name) => {
	const i = argv.indexOf(name);
	return i > -1 ? argv[i + 1] : undefined;
};

function killTree(/** @type {number} */ pid) {
	try {
		if (process.platform === "win32")
			execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
				windowsHide: true,
				stdio: "ignore",
			});
		else process.kill(-pid, "SIGKILL");
	} catch {}
}

/**
 * Runs a node CLI to its end or the hard timeout (Playwright sometimes never exits here),
 * then kills its tree. Ends early once `done` exists, the file the tool writes last.
 */
async function runCli(
	/** @type {string[]} */ args,
	/** @type {Record<string, string | undefined>} */ env,
	/** @type {{ cwd: string, timeoutMin: number, done?: string }} */ o,
) {
	if (o.done) rmSync(o.done, { force: true });
	const child = spawn(process.execPath, args, {
		cwd: o.cwd,
		env: { ...process.env, ...env },
		stdio: ["ignore", "inherit", "inherit"],
		windowsHide: true,
		detached: process.platform !== "win32",
	});
	/** @type {number | null} */
	let code = null;
	child.on("exit", (c) => {
		code = c ?? 1;
	});
	const until = Date.now() + o.timeoutMin * 60_000;
	while (code === null && !(o.done && existsSync(o.done)) && Date.now() < until)
		await sleep(3000);
	if (code === null) {
		await sleep(3000);
		if (child.pid) killTree(child.pid);
		if (!(o.done && existsSync(o.done)))
			log(`stopped after ${o.timeoutMin} min: ${args.slice(0, 3).join(" ")}`);
	}
	return code;
}

/** The registry's bar items: id → category, mark, text. */
function barItems() {
	const m = JSON.parse(
		readFileSync(join(FRONTEND, "src/registry/registry.manifest.json"), "utf8"),
	);
	/** @type {Record<string, { category: string, mark: "checked" | "static" | "judged", text: string }>} */
	const items = m.closed?.barItem?.members ?? {};
	return items;
}

/** Brings up a sim with every condition in `dir`; returns false when it did not come up. */
async function simUp(/** @type {string} */ dir, /** @type {boolean} */ build) {
	log(`booting a sim with every condition in ${dir} (about 8 min)`);
	await runCli(
		[
			join(ROOT, "scripts/sim/sim.mjs"),
			"up",
			"--profile",
			"all",
			"--mode",
			"built",
		],
		{
			PRISMALENS_SIM_DIR: dir,
			PRISMALENS_SIM_PREBUILT: build ? undefined : "1",
		},
		{ cwd: ROOT, timeoutMin: build ? 40 : 25 },
	);
	return existsSync(join(dir, "sheet.json"));
}

async function simDown(/** @type {string} */ dir) {
	await runCli(
		[join(ROOT, "scripts/sim/sim.mjs"), "down"],
		{ PRISMALENS_SIM_DIR: dir },
		{ cwd: ROOT, timeoutMin: 3 },
	);
}

/** Runs the static items (vitest on the registry) and the checked ones (Playwright on the sim). */
export async function runChecks(
	/** @type {{ out: string, sim?: string, only?: string, fast?: boolean, timeoutMin?: number, build?: boolean }} */ o,
) {
	const dir = join(o.out, "checks");
	rmSync(join(dir, "results"), { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	log("static items: vitest on the registry");
	await runCli(
		[
			join(FRONTEND, "node_modules/vitest/vitest.mjs"),
			"run",
			"src/registry/bar-static.test.ts",
			"--reporter=json",
			`--outputFile=${join(dir, "static.json")}`,
		],
		{},
		{ cwd: FRONTEND, timeoutMin: 5 },
	);
	const own = !o.sim;
	const simDir = resolve(o.sim ?? join(o.out, "sim"));
	if (own && !(await simUp(simDir, !!o.build))) {
		log("the sim did not come up: checked items read as not run");
		return;
	}
	try {
		log(`checked items: Playwright on ${simDir}`);
		await runCli(
			[
				createRequire(join(FRONTEND, "package.json")).resolve(
					"@playwright/test/cli",
				),
				"test",
				"-c",
				"playwright.bar.config.ts",
			],
			{
				BAR_SIM_DIR: simDir,
				BAR_OUT: dir,
				BAR_ONLY: o.only,
				BAR_FAST: o.fast ? "1" : undefined,
				PLAYWRIGHT_JSON_OUTPUT_NAME: join(dir, "playwright.json"),
			},
			{
				cwd: FRONTEND,
				timeoutMin: o.timeoutMin ?? 90,
				done: join(dir, "playwright.json"),
			},
		);
	} finally {
		if (own) await simDown(simDir);
	}
}

const cell = (/** @type {string} */ t) =>
	t.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** checks.md: a count per category, then one row per checked or static item. */
export function writeChecks(/** @type {string} */ out) {
	const dir = join(out, "checks");
	const items = barItems();
	/** @type {Record<string, { status: string, value?: string, shot?: string }>} */
	const results = {};
	const rdir = join(dir, "results");
	if (existsSync(rdir))
		for (const f of readdirSync(rdir).filter((x) => x.endsWith(".json")))
			try {
				const r = JSON.parse(readFileSync(join(rdir, f), "utf8"));
				results[r.item] = r;
			} catch {}
	const sfile = join(dir, "static.json");
	if (existsSync(sfile)) {
		const rep = JSON.parse(readFileSync(sfile, "utf8"));
		for (const t of (rep.testResults ?? []).flatMap(
			(/** @type {{ assertionResults: object[] }} */ x) => x.assertionResults,
		)) {
			const id = /^(\d+\.\w+) /.exec(t.title)?.[1];
			if (!id || !items[id]) continue;
			results[id] = {
				status: t.status === "passed" ? "pass" : "fail",
				value: `registry: ${t.title.slice(id.length + 1)}${t.status === "passed" ? "" : ` (${cell(String(t.failureMessages?.[0] ?? "").split("\n")[0]).slice(0, 200)})`}`,
			};
		}
	}
	const ids = Object.keys(items);
	const cats = [...new Set(ids.map((id) => items[id].category))];
	// A check that threw or timed out says nothing about the app: it reads "check error", not fail.
	const of = (/** @type {string} */ id) => {
		const r = results[id];
		if (!r) return "not run";
		return r.status === "fail" && /^check (threw|timed out)/.test(r.value ?? "")
			? "check error"
			: r.status;
	};
	const word = /** @type {Record<string, string>} */ ({
		pass: "pass",
		fail: "**FAIL**",
		"check error": "check error",
		"no check": "no check",
		"not set up": "not set up",
		"not run": "not run",
	});
	const rows = ids.filter((id) => items[id].mark !== "judged");
	const count = (/** @type {string} */ cat, /** @type {string} */ st) =>
		rows.filter((id) => items[id].category === cat && of(id) === st).length;
	const n = (/** @type {string} */ mark) =>
		ids.filter((id) => items[id].mark === mark).length;
	const lines = [
		"# Bar checks",
		"",
		`Every bar item of #1101 is marked in the registry (packages/frontend/src/registry/closed/bar-item.ts): ${n("checked")} checked by a script on the simulated app (every condition, the slow link and the CPU slowed 4×), ${n("static")} static (proved from the registry by ui:check:static), ${n("judged")} judged by you. A checked item with no script yet reads "no check", never pass; "not set up" means the sim could not hold its condition when it ran (the measured column says why), and counts as neither; "check error" means the script itself threw or timed out, so it proves nothing either way: test that item yourself; "not run" means the run stopped before it. Only a fail counts toward the cap. Take a pass or a fail as fact, spot-check 2 per category, and judge the rest.`,
		"",
		"## Per category",
		"",
		"| Cat | Pass | Fail | Check error | Not set up | No check | Not run | Judged |",
		"| :-- | --: | --: | --: | --: | --: | --: | --: |",
		...cats.map(
			(c) =>
				`| ${c} | ${count(c, "pass")} | ${count(c, "fail")} | ${count(c, "check error")} | ${count(c, "not set up")} | ${count(c, "no check")} | ${count(c, "not run")} | ${ids.filter((id) => items[id].category === c && items[id].mark === "judged").length} |`,
		),
		"",
		"## Items",
		"",
		"| Cat | Item | Mark | Result | Measured | Failure shot |",
		"| :-- | :-- | :-- | :-- | :-- | :-- |",
		...rows.map((id) => {
			const r = results[id];
			const shot = r?.shot ? relative(out, r.shot).split("\\").join("/") : "";
			return `| ${items[id].category} | ${id} ${cell(items[id].text).slice(0, 90)} | ${items[id].mark} | ${word[of(id)] ?? of(id)} | ${cell(r?.value ?? "")} | ${shot} |`;
		}),
		"",
		"## Judged items (yours)",
		"",
		...ids
			.filter((id) => items[id].mark === "judged")
			.map((id) => `- ${id}: ${items[id].text}`),
	];
	writeFileSync(join(out, "checks.md"), `${lines.join("\n")}\n`);
	const fails = rows.filter((id) => of(id) === "fail").length;
	log(
		`checks.md: ${rows.filter((id) => of(id) === "pass").length} pass, ${fails} fail, ${rows.filter((id) => of(id) === "check error").length} check error, ${rows.filter((id) => of(id) === "no check").length} no check, ${rows.filter((id) => of(id) === "not run").length} not run`,
	);
	return fails;
}

/** @param {string[]} argv */
export async function main(argv) {
	const out = resolve(
		opt(argv, "--out") ??
			join(
				ROOT,
				".sim",
				"bar-checks",
				new Date().toISOString().replace(/[:.]/g, "-"),
			),
	);
	mkdirSync(out, { recursive: true });
	if (!argv.includes("--report-only"))
		await runChecks({
			out,
			sim: opt(argv, "--sim"),
			only: opt(argv, "--only"),
			fast: argv.includes("--fast"),
			// judge-evidence has built the frontend already; alone, the sim builds it.
			build: !argv.includes("--no-build"),
			timeoutMin: Number(opt(argv, "--timeout-min") ?? 90),
		});
	writeChecks(out);
	log(`checks: ${join(out, "checks.md")}`);
	return 0;
}
