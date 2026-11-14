// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// `pnpm sim judge-evidence` (#1101 Scores): the evidence every judge reads instead of shooting
// it again. Runs the design matrix and the notification log through the slow link with the
// CPU slowed 4×, at 1440 and 390, then writes measures.md and one comparison image per
// category: its reference screens beside the PrismaLens shots the registry maps to it.
//   pnpm sim judge-evidence [--out <dir>] [--references <survey screens dir>] [--themes dark,light]
//                           [--no-build] [--timeout-min 170] [--compare-only]
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
import { basename, join, resolve } from "node:path";
import { freePort } from "../fakes/conditions/lib.mjs";
import { ROOT } from "./lib.mjs";

const FRONTEND = join(ROOT, "packages/frontend");
const WIDTHS = "1440x900,390x844";
const SPECS = [
	"e2e/journeys/design-matrix.spec.ts",
	"e2e/journeys/judge-notifications.spec.ts",
];
const IMAGE = /\.(png|jpe?g|webp)$/i;
/** Per category: at most this many shots a side, so one image stays readable. */
const PER_SIDE = 6;

const log = (/** @type {string} */ m) => console.log(`[judge-evidence] ${m}`);
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
 * Playwright never exits on its own here once its servers are up, so the run ends when its
 * json report lands (it is written last), or at the hard timeout; either way its tree is killed.
 */
async function runMatrix(
	/** @type {string} */ out,
	/** @type {string} */ themes,
	/** @type {number} */ timeoutMin,
) {
	const report = join(out, "playwright.json");
	rmSync(report, { force: true });
	const env = {
		...process.env,
		DESIGN_SHOTS: "1",
		DESIGN_SHOTS_DIR: join(out, "shots"),
		DESIGN_WIDTHS: WIDTHS,
		DESIGN_THEMES: themes,
		DESIGN_SLOW: "1",
		PRISMALENS_E2E_BUILT: "1",
		PRISMALENS_SIM_PREBUILT: "1",
		PLAYWRIGHT_JSON_OUTPUT_NAME: report,
		PRISMALENS_FRONTEND_PORT: String(await freePort()),
		PRISMALENS_PORT: String(await freePort()),
	};
	const cli = createRequire(join(FRONTEND, "package.json")).resolve(
		"@playwright/test/cli",
	);
	const child = spawn(
		process.execPath,
		[cli, "test", ...SPECS, "--project=chromium", "--workers=1"],
		{
			cwd: FRONTEND,
			env,
			stdio: ["ignore", "inherit", "inherit"],
			windowsHide: true,
			detached: process.platform !== "win32",
		},
	);
	let exited = false;
	child.on("exit", () => {
		exited = true;
	});
	const until = Date.now() + timeoutMin * 60_000;
	while (!exited && !existsSync(report) && Date.now() < until)
		await sleep(5000);
	const stopped = exited;
	if (!exited) {
		await sleep(3000);
		if (child.pid) killTree(child.pid);
	}
	if (!existsSync(report))
		log(
			stopped
				? "Playwright exited with no report (its servers never started? see the output above); kept what was shot"
				: `no Playwright report after ${timeoutMin} min; kept what was shot`,
		);
	return existsSync(report)
		? JSON.parse(readFileSync(report, "utf8")).stats
		: null;
}

/** @typedef {{ contrast: { ratio: string, text: string }[], smallTargets: { name: string, w: number, h: number }[], clipped: string[], sideways: string[], consoleErrors: string[], axeOther: string[], firstContentMs?: number, longestTaskMs?: number }} Measure */

const cellText = (/** @type {string} */ t) =>
	t.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 80);

/** measures.md: one row per shot, then each shot's findings, then the notification log. */
function writeMeasures(/** @type {string} */ out, stats) {
	const shots = join(out, "shots");
	const matrix = existsSync(join(shots, "matrix.json"))
		? JSON.parse(readFileSync(join(shots, "matrix.json"), "utf8"))
		: { report: {}, walk: {} };
	/** @type {Record<string, Measure>} */
	const report = matrix.report ?? {};
	const keys = Object.keys(report).sort();
	const ms = (/** @type {number | undefined} */ v) =>
		v === undefined ? "" : String(Math.round(v));
	const lines = [
		"# Judge evidence: measures",
		"",
		`Every page loaded through the slow link (400 ms round trip, 1.6 Mbps down, 0.75 up) with the CPU slowed 4×, at ${WIDTHS.replace(",", " and ")}. Shots are native resolution in ./shots (name = screen-width-theme). Contrast is axe's computed ratio: never estimate it from pixels.`,
		"",
		stats
			? `Playwright: ${stats.expected} passed, ${stats.unexpected} failed, ${stats.skipped} skipped, ${Math.round(stats.duration / 1000)} s.`
			: "Playwright: no report (timed out or failed); the shots and rows below are what it reached.",
		"",
		"| Shot | First content ms | Longest task ms | Contrast fails | Targets < 24 px | Clipped | Sideways | Console errors | Other axe |",
		"| :-- | --: | --: | --: | --: | --: | --: | --: | --: |",
		...keys.map((k) => {
			const m = report[k];
			return `| ${k} | ${ms(m.firstContentMs)} | ${ms(m.longestTaskMs)} | ${m.contrast.length} | ${m.smallTargets.length} | ${m.clipped.length} | ${m.sideways.length} | ${m.consoleErrors.length} | ${m.axeOther.length} |`;
		}),
		"",
		"## Findings per shot",
	];
	for (const k of keys) {
		const m = report[k];
		const items = [
			...m.contrast.map(
				(c) => `contrast ${c.ratio}:1 on \`${cellText(c.text)}\``,
			),
			...m.smallTargets.map(
				(t) => `target ${t.w}×${t.h} px: ${cellText(t.name)}`,
			),
			...m.clipped.map((c) => `clipped: ${cellText(c)}`),
			...m.sideways.map((s) => `sideways: ${cellText(s)}`),
			...m.consoleErrors.map((e) => `console: ${cellText(e)}`),
			...m.axeOther.map((a) => `axe: ${cellText(a)}`),
		];
		if (items.length) lines.push("", `### ${k}`, ...items.map((i) => `- ${i}`));
	}
	const kit = join(shots, "kit", "kit-axe.json");
	if (existsSync(kit)) {
		lines.push("", "## Design kit states (axe, per width)");
		for (const [k, v] of Object.entries(JSON.parse(readFileSync(kit, "utf8"))))
			lines.push(
				`- ${k}: ${/** @type {string[]} */ (v).join("; ") || "clean"}`,
			);
	}
	const notes = join(shots, "notifications.json");
	lines.push("", "## Notifications, the badge and the toast (category 4)");
	if (existsSync(notes)) {
		lines.push(
			"A headless browser shows no OS notification, so the page's Notification and app badge were stubbed and every call logged; notify-os-*.png draws each logged notification, notify-toast-*.png and notify-back-*.png are the page.",
			"",
		);
		for (const run of JSON.parse(readFileSync(notes, "utf8"))) {
			lines.push(`### ${run.width} px`, ...run.steps.map((s) => `- ${s}`));
			for (const n of run.os)
				lines.push(`- OS notification: "${n.title}": ${n.body ?? ""}`);
			lines.push(
				`- Badge calls: ${JSON.stringify(run.badge)}; tab titles: ${run.titles.map((/** @type {string} */ t) => `"${t}"`).join(", ") || "none"}`,
			);
		}
	} else lines.push("No notification log: the notification spec did not run.");
	if (matrix.walk && Object.keys(matrix.walk).length) {
		lines.push("", "## Keyboard walk (Tab stops)");
		for (const [k, stops] of Object.entries(matrix.walk))
			lines.push(`- ${k}: ${/** @type {string[]} */ (stops).join(" → ")}`);
	}
	writeFileSync(join(out, "measures.md"), `${lines.join("\n")}\n`);
	return keys.length;
}

/** The registry's categories: title, reference folder and shot prefixes. */
function categories() {
	const manifest = JSON.parse(
		readFileSync(join(FRONTEND, "src/registry/registry.manifest.json"), "utf8"),
	);
	/** @type {Record<string, { title: string, reference?: string, shots?: string[] }>} */
	const members = manifest.closed?.category?.members ?? {};
	return members;
}

/** The PrismaLens shots a category's prefixes pick: desk width first, `*-390-` picks the phone. */
function pick(/** @type {string[]} */ files, /** @type {string[]} */ prefixes) {
	const out = [];
	for (const p of prefixes) {
		const hits = p.startsWith("*")
			? files.filter((f) => f.includes(p.slice(1)))
			: files.filter(
					(f) =>
						basename(f).startsWith(p) &&
						(f.includes("-1440-") || !/-\d{3,4}-/.test(basename(f))),
				);
		for (const h of hits) if (!out.includes(h)) out.push(h);
	}
	return out.slice(0, PER_SIDE);
}

const dataUri = (/** @type {string} */ f) =>
	`data:image/${f.toLowerCase().endsWith(".png") ? "png" : "jpeg"};base64,${readFileSync(f).toString("base64")}`;

/** One image per category: references on the left, PrismaLens on the right, each captioned. */
async function writeComparisons(
	/** @type {string} */ out,
	/** @type {string | undefined} */ references,
) {
	const shots = join(out, "shots");
	const ours = [
		...(existsSync(shots) ? readdirSync(shots).map((f) => join(shots, f)) : []),
		...(existsSync(join(shots, "kit"))
			? readdirSync(join(shots, "kit")).map((f) => join(shots, "kit", f))
			: []),
	].filter((f) => IMAGE.test(f));
	const dir = join(out, "compare");
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const { chromium } = createRequire(join(FRONTEND, "package.json"))(
		"@playwright/test",
	);
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 1800, height: 900 },
	});
	const written = [];
	try {
		for (const [id, c] of Object.entries(categories())) {
			const ref = c.reference ?? "none";
			const refDir = references && ref !== "none" ? join(references, ref) : "";
			const left =
				refDir && existsSync(refDir)
					? readdirSync(refDir)
							.filter((f) => IMAGE.test(f))
							.slice(0, PER_SIDE)
							.map((f) => join(refDir, f))
					: [];
			const right = pick(ours, c.shots ?? []);
			const col = (
				/** @type {string[]} */ files,
				/** @type {string} */ empty,
				ref = false,
			) =>
				files.length
					? files
							.map(
								(f, i) =>
									`<figure><img src="${dataUri(f)}"><figcaption>${ref ? `reference ${String.fromCharCode(65 + i)}` : basename(f)}</figcaption></figure>`,
							)
							.join("")
					: `<p class="none">${empty}</p>`;
			await page.setContent(
				`<style>body{margin:0;background:#111;color:#ddd;font:14px system-ui}h1{font-size:18px;margin:12px 16px}.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:0 16px 16px}h2{font-size:14px;color:#aaa;margin:4px 0 8px}figure{margin:0 0 12px}img{width:100%;border:1px solid #333}figcaption{font-size:12px;color:#999}.none{color:#888}</style><h1>Category ${id}: ${c.title}</h1><div class="cols"><div><h2>Reference (${ref})</h2>${col(left, ref === "none" ? "No reference: the survey has no shot of this." : "No reference folder given (--references).", true)}</div><div><h2>PrismaLens (slow link, CPU 4×)</h2>${col(right, "No matrix shot shows this: walk it.")}</div></div>`,
				{ waitUntil: "load" },
			);
			const file = `${id.padStart(2, "0")}-${c.title
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/-+$/, "")}.png`;
			await page.screenshot({ path: join(dir, file), fullPage: true });
			written.push(file);
		}
	} finally {
		await browser.close();
	}
	return written;
}

/** @param {string[]} argv */
export async function main(argv) {
	const out = resolve(
		opt(argv, "--out") ??
			join(
				ROOT,
				".sim",
				"judge-evidence",
				new Date().toISOString().replace(/[:.]/g, "-"),
			),
	);
	const references =
		opt(argv, "--references") ?? process.env.PRISMALENS_REFERENCE_SCREENS;
	const themes = opt(argv, "--themes") ?? "dark";
	const timeoutMin = Number(opt(argv, "--timeout-min") ?? 170);
	mkdirSync(out, { recursive: true });
	let stats = null;
	if (!argv.includes("--compare-only")) {
		// A built sim serves packages/frontend/dist: rebuilding under it would break its pages.
		const simState = join(ROOT, ".sim", "state.json");
		const builtSim =
			existsSync(simState) &&
			JSON.parse(readFileSync(simState, "utf8")).mode === "built";
		if (builtSim) log("a built sim is up: shooting its build, not rebuilding");
		if (!argv.includes("--no-build") && !builtSim) {
			log("building the frontend with the design gallery");
			execFileSync(
				process.execPath,
				["node_modules/vite/bin/vite.js", "build"],
				{
					windowsHide: true,
					cwd: FRONTEND,
					env: { ...process.env, VITE_DESIGN_GALLERY: "1" },
					stdio: "ignore",
				},
			);
		}
		log(
			`shooting the matrix and the notification log into ${join(out, "shots")}`,
		);
		stats = await runMatrix(out, themes, timeoutMin);
	}
	const rows = writeMeasures(out, stats);
	if (!references)
		log(
			"no --references (or PRISMALENS_REFERENCE_SCREENS): comparison images carry PrismaLens only",
		);
	const compare = await writeComparisons(out, references);
	log(
		`measures.md: ${rows} shots measured; compare/: ${compare.length} images`,
	);
	log(`evidence: ${out}`);
	return stats && stats.unexpected > 0 ? 1 : 0;
}
