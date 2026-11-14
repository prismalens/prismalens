// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The judges' recall test (#1101 Scores, checkpoint 5): ten shots of a running sim, six of
// them with one planted defect each, one per check the recall prompt names. The key goes to
// its own file, never beside the shots, and `score` grades a judge's table against it.
//   pnpm sim recall make --out <shots dir> --key <key.json> [--seed <n>]   (a sim must be up)
//   pnpm sim recall score --key <key.json> --answers <judge result.md> [--json]
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { ROOT } from "./lib.mjs";

const SIM = resolve(process.env.PRISMALENS_SIM_DIR ?? join(ROOT, ".sim"));

/** The checks the recall prompt asks for, by number (round 1's recall-prompt-v2). */
export const CHECKS = {
	1: "navigation",
	2: "duplicates",
	3: "copy length",
	4: "faint text",
	5: "dead ends",
	6: "anything else",
};

/** The screens shot, at 1440×900; the first threads a stage printed fill `{thread}`. */
const SCREENS = [
	"/new",
	"/settings?tab=general",
	"/settings?tab=usage",
	"/automation",
	"/services",
	"/events",
	"{thread:0}",
	"{thread:1}",
	"{thread:2}",
	"/settings?tab=shortcuts",
];

/**
 * One defect per check. Each runs in the page, changes one element and returns what it
 * changed, which goes to the key; it never runs on a shot without a defect.
 */
const DEFECTS = {
	"vague-nav": {
		check: 1,
		heuristics: [2, 4, 6],
		plant: () => {
			const links = [...document.querySelectorAll("nav a, aside a")].filter(
				(a) => a.textContent?.trim() && a.getBoundingClientRect().width > 0,
			);
			const a = links[Math.min(2, links.length - 1)];
			if (!a) return null;
			const was = a.textContent?.trim() ?? "";
			const leaf = [...a.querySelectorAll("*")]
				.concat(a)
				.find((n) => n.childElementCount === 0 && n.textContent?.trim());
			if (leaf) leaf.textContent = "Things";
			return `the sidebar item "${was}" renamed "Things"`;
		},
	},
	duplicate: {
		check: 2,
		heuristics: [4, 8],
		plant: () => {
			const b = [
				...document.querySelectorAll("main button, main a[href]"),
			].find((x) => {
				const r = x.getBoundingClientRect();
				return r.width > 40 && r.height > 20 && x.textContent?.trim();
			});
			if (!b) return null;
			b.after(b.cloneNode(true));
			return `the control "${b.textContent?.trim()}" shown twice, side by side`;
		},
	},
	"long-copy": {
		check: 3,
		heuristics: [8],
		plant: () => {
			const t = [
				...document.querySelectorAll("main p, main span, main div"),
			].find(
				(x) =>
					x.childElementCount === 0 &&
					/^\S+(\s\S+){1,4}$/.test(x.textContent?.trim() ?? "") &&
					x.getBoundingClientRect().width > 30,
			);
			if (!t) return null;
			const was = t.textContent?.trim();
			t.textContent =
				"There is currently nothing at all to show here because nothing has happened in this place yet.";
			return `"${was}" replaced by a 17-word sentence`;
		},
	},
	"faint-text": {
		check: 4,
		heuristics: [1, 8],
		plant: () => {
			// The page's own text, never a toast floating over it.
			const t = [
				...document.querySelectorAll("main h1, main h2, main h3, main p"),
			].find(
				(x) =>
					(x.textContent?.trim().length ?? 0) > 6 &&
					x.getBoundingClientRect().width > 40 &&
					!x.closest(
						'li, [role="status"], [role="region"], [data-testid="attention-toast"]',
					),
			);
			if (!t) return null;
			// The text takes the first opaque background behind it, nudged a little: about 1.3:1.
			let bg = getComputedStyle(document.body).backgroundColor;
			for (let n = t; n; n = n.parentElement) {
				const c = getComputedStyle(n).backgroundColor;
				if (/^rgb\(/.test(c)) {
					bg = c;
					break;
				}
			}
			const [r, g, b] = (bg.match(/\d+/g) ?? ["128", "128", "128"]).map(Number);
			const dark = (r ?? 0) + (g ?? 0) + (b ?? 0) < 384;
			const nudge = (v = 0) =>
				Math.max(0, Math.min(255, v + (dark ? 28 : -28)));
			t.style.color = `rgb(${nudge(r)}, ${nudge(g)}, ${nudge(b)})`;
			return `the text "${t.textContent?.trim().slice(0, 40)}" faded to about 1.3:1`;
		},
	},
	"dead-end": {
		check: 5,
		heuristics: [9, 10],
		plant: () => {
			const main = document.querySelector("main");
			if (!main) return null;
			main.innerHTML =
				'<div style="display:flex;height:100%;min-height:60vh;align-items:center;justify-content:center;opacity:.8">Something went wrong.</div>';
			return "the page body replaced by an error with no next step";
		},
	},
	"tiny-target": {
		check: 6,
		heuristics: [7],
		plant: () => {
			const b = [...document.querySelectorAll("main button")].find((x) => {
				const r = x.getBoundingClientRect();
				return r.width >= 24 && r.height >= 24 && x.textContent?.trim();
			});
			if (!b) return null;
			Object.assign(b.style, {
				width: "12px",
				height: "12px",
				minWidth: "0",
				minHeight: "0",
				padding: "0",
				fontSize: "6px",
				overflow: "hidden",
			});
			return `the button "${b.textContent?.trim()}" shrunk to 12×12 px`;
		},
	},
};

/** A small deterministic shuffle, so a seed reproduces a set. */
function shuffled(/** @type {any[]} */ xs, /** @type {number} */ seed) {
	const out = [...xs];
	let s = seed || 1;
	for (let i = out.length - 1; i > 0; i--) {
		s = (s * 1103515245 + 12345) % 2147483648;
		const j = s % (i + 1);
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/** @param {string[]} argv @param {string} name */
const opt = (argv, name) => {
	const i = argv.indexOf(name);
	return i > -1 ? argv[i + 1] : undefined;
};

async function make(/** @type {string[]} */ argv) {
	const out = resolve(opt(argv, "--out") ?? "");
	const keyFile = resolve(opt(argv, "--key") ?? "");
	if (!opt(argv, "--out") || !opt(argv, "--key"))
		throw new Error("pass --out <shots dir> and --key <key.json>");
	if (!relative(out, keyFile).startsWith(".."))
		throw new Error("the key must live outside the shots folder judges read");
	const seed = Number(opt(argv, "--seed") ?? Date.now() % 100000);
	const state = JSON.parse(readFileSync(join(SIM, "state.json"), "utf8"));
	const sheet = JSON.parse(readFileSync(join(SIM, "sheet.json"), "utf8"));
	const threads = sheet.rows.flatMap(
		(/** @type {{ links: string[] }} */ r) => r.links,
	);
	const token = execSync(
		"pnpm --silent --filter prismalens dev pair --operator",
		{
			cwd: ROOT,
			encoding: "utf8",
			env: { ...process.env, PRISMALENS_WORKSPACE_DIR: state.workspace },
		},
	).match(/\/pair#([^\s#]+)/)?.[1];
	if (!token) throw new Error("the pair command printed no link");

	const plan = shuffled(Object.keys(DEFECTS), seed);
	const shots = shuffled([...SCREENS.keys()], seed + 7).slice(0, plan.length);
	/** @type {Map<number, string>} */
	const planted = new Map(shots.map((s, i) => [s, plan[i]]));

	const { chromium } = createRequire(
		join(ROOT, "packages/frontend/package.json"),
	)("@playwright/test");
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	mkdirSync(out, { recursive: true });
	const key = [];
	try {
		await page.goto(`${state.url}/pair#${token}`);
		await page.waitForURL(/\/(new|incidents|threads)/, { timeout: 60_000 });
		for (const [i, screen] of SCREENS.entries()) {
			const m = screen.match(/^\{thread:(\d)\}$/);
			const url = m ? threads[Number(m[1])] : `${state.url}${screen}`;
			if (!url)
				throw new Error(
					`no thread link for ${screen}: is the sim profile all?`,
				);
			await page.goto(url);
			await page.waitForLoadState("load").catch(() => {});
			await page.waitForTimeout(2500);
			const name = `s${String(i + 1).padStart(2, "0")}`;
			const defect = planted.get(i);
			if (defect) {
				const d = DEFECTS[/** @type {keyof typeof DEFECTS} */ (defect)];
				const what = await page.evaluate(d.plant);
				if (!what)
					throw new Error(
						`${defect} found nothing to change on ${screen}; try another --seed`,
					);
				key.push({
					shot: name,
					defect,
					check: d.check,
					heuristics: d.heuristics,
					what,
					screen,
				});
				await page.waitForTimeout(300);
			}
			await page.screenshot({
				path: join(out, `${name}.png`),
				animations: "disabled",
			});
		}
	} finally {
		await browser.close();
	}
	mkdirSync(dirname(keyFile), { recursive: true });
	writeFileSync(
		keyFile,
		`${JSON.stringify({ seed, shots: SCREENS.length, planted: key }, null, 2)}\n`,
	);
	console.log(
		`recall: ${SCREENS.length} shots in ${out}; ${key.length} defects planted; key ${keyFile} (keep it from judges)`,
	);
}

/** The check a row names: its number, or a word from its name. */
function checkOf(/** @type {string} */ cell) {
	const n = cell.match(/\b([1-6])\b/)?.[1];
	if (n) return Number(n);
	const t = cell.toLowerCase();
	if (/nav/.test(t)) return 1;
	if (/dup/.test(t)) return 2;
	if (/copy|word|length/.test(t)) return 3;
	if (/faint|contrast/.test(t)) return 4;
	if (/dead|error/.test(t)) return 5;
	return 6;
}

/** Grades a judge's answers: a defect is caught when a finding on its shot names its check. */
export function score(
	/** @type {{ planted: { shot: string, defect: string, check: number }[], shots: number }} */ key,
	/** @type {string} */ answers,
) {
	/** @type {{ shot: string, check: number, text: string }[]} */
	const rows = [];
	for (const line of answers.split(/\r?\n/)) {
		if (!line.trim().startsWith("|")) continue;
		const cells = line
			.split("|")
			.slice(1, -1)
			.map((c) => c.trim());
		const shot = cells[0]?.match(/s(\d{2})/i)?.[1];
		if (!shot || cells.length < 3) continue;
		const text = cells.slice(2).join(" ");
		if (/^\s*(none|—|-|n\/a)\s*\.?\s*$/i.test(text)) continue;
		rows.push({ shot: `s${shot}`, check: checkOf(cells[1] ?? ""), text });
	}
	const caught = key.planted.map((p) => ({
		...p,
		caught: rows.some((r) => r.shot === p.shot && r.check === p.check),
	}));
	const dirty = new Set(key.planted.map((p) => p.shot));
	const clean = rows.filter((r) => !dirty.has(r.shot));
	return {
		recall: caught.filter((c) => c.caught).length,
		of: caught.length,
		missed: caught
			.filter((c) => !c.caught)
			.map((c) => `${c.shot} ${c.defect} (check ${c.check})`),
		findingsOnCleanShots: clean.length,
		findings: rows.length,
	};
}

/** @param {string[]} argv */
export async function main(argv) {
	const [cmd, ...rest] = argv;
	if (cmd === "make") {
		await make(rest);
		return 0;
	}
	if (cmd === "score") {
		const keyFile = opt(rest, "--key");
		const answers = opt(rest, "--answers");
		if (!keyFile || !answers || !existsSync(keyFile) || !existsSync(answers))
			throw new Error(
				"pass --key <key.json> and --answers <the judge's result file>",
			);
		const r = score(
			JSON.parse(readFileSync(keyFile, "utf8")),
			readFileSync(answers, "utf8"),
		);
		console.log(
			rest.includes("--json")
				? JSON.stringify(r, null, 2)
				: `recall ${r.recall}/${r.of}; missed: ${r.missed.join(", ") || "none"}; ${r.findingsOnCleanShots} of ${r.findings} findings on clean shots`,
		);
		return 0;
	}
	console.log(
		"Usage: pnpm sim recall make --out <shots dir> --key <key.json> [--seed <n>]\n       pnpm sim recall score --key <key.json> --answers <result.md> [--json]",
	);
	return cmd ? 1 : 0;
}
