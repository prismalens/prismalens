// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Fetch the system libraries Playwright's Chromium needs into a gitignored
 * directory, without root, and print the LD_LIBRARY_PATH that loads them.
 *
 *   pnpm e2e:libs                 # then run the export line it prints
 *
 * The package list is Playwright's own (`install-deps --dry-run chromium` lists
 * what is missing on this host); each package is fetched with `apt-get download`
 * and unpacked with `dpkg -x`, neither of which needs root. Debian/Ubuntu only.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = join(repo, "packages/frontend");
const outDir = join(frontend, "e2e/.libs");

if (process.platform !== "linux") {
	console.log("e2e-libs: only Linux needs this; nothing to do.");
	process.exit(0);
}
for (const tool of ["apt-get", "dpkg"]) {
	try {
		execFileSync("sh", ["-c", `command -v ${tool}`], { stdio: "ignore" });
	} catch {
		console.error(
			`e2e-libs: ${tool} not found; this script needs Debian or Ubuntu.`,
		);
		process.exit(1);
	}
}

const require = createRequire(join(frontend, "package.json"));
const playwrightCli = require.resolve("@playwright/test/cli");

/**
 * Playwright 1.63 lists one package per indented line and exits 1 when any is
 * missing; older releases print an apt-get command.
 */
function missingPackages() {
	const { stdout: out, error } = spawnSync(
		process.execPath,
		[playwrightCli, "install-deps", "--dry-run", "chromium"],
		{ cwd: frontend, encoding: "utf8" },
	);
	if (error) throw error;
	const apt = out.match(
		/apt-get install[^"\n]*?--no-install-recommends ([^"\n]+)/,
	);
	if (apt) return apt[1].trim().split(/\s+/);
	const pkgs = [];
	let listing = false;
	for (const line of out.split("\n")) {
		if (/^Missing system dependencies/.test(line)) listing = true;
		else if (listing && /^\s+\S+$/.test(line)) pkgs.push(line.trim());
		else if (listing) listing = false;
	}
	return pkgs;
}

/** Every directory under `outDir` that holds a shared object, deepest first. */
function libDirs() {
	const dirs = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (/\.so(\.|$)/.test(entry.name) && !dirs.includes(dir))
				dirs.push(dir);
		}
	};
	const root = join(outDir, "root");
	if (existsSync(root)) walk(root);
	return dirs;
}

/** Sonames Chromium still cannot load with `ldPath`, over every installed Chromium build. */
function unresolved(ldPath) {
	const { chromium } = require("@playwright/test");
	const browsers = resolve(dirname(chromium.executablePath()), "../..");
	const binaries = readdirSync(browsers)
		.filter((d) => d.startsWith("chromium"))
		.flatMap((d) => {
			const dir = join(browsers, d);
			return readdirSync(dir).flatMap((sub) =>
				["chrome", "chrome-headless-shell"]
					.map((b) => join(dir, sub, b))
					.filter((p) => existsSync(p)),
			);
		});
	const missing = new Set();
	for (const bin of binaries) {
		const out = execFileSync("ldd", [bin], {
			encoding: "utf8",
			env: { ...process.env, LD_LIBRARY_PATH: ldPath },
		});
		for (const m of out.matchAll(/^\s*(\S+) => not found/gm)) missing.add(m[1]);
	}
	return { binaries, missing: [...missing] };
}

const pkgs = missingPackages();
const debs = join(outDir, "debs");
mkdirSync(debs, { recursive: true });
mkdirSync(join(outDir, "root"), { recursive: true });
const failed = [];
for (const pkg of pkgs) {
	try {
		execFileSync("apt-get", ["download", pkg], { cwd: debs, stdio: "pipe" });
	} catch (e) {
		failed.push(
			`${pkg}: ${String(e.stderr ?? e.message)
				.trim()
				.split("\n")
				.pop()}`,
		);
	}
}
for (const deb of readdirSync(debs).filter((f) => f.endsWith(".deb"))) {
	execFileSync("dpkg", ["-x", join(debs, deb), join(outDir, "root")]);
}
rmSync(debs, { recursive: true, force: true });

const ldPath = [...libDirs(), process.env.LD_LIBRARY_PATH]
	.filter(Boolean)
	.join(":");
const { binaries, missing } = unresolved(ldPath);

console.log(
	`e2e-libs: ${pkgs.length} package(s) Playwright lists as missing; ${pkgs.length - failed.length} fetched into ${join(outDir, "root")}`,
);
for (const f of failed) console.error(`e2e-libs: could not download ${f}`);
console.log(`e2e-libs: checked ${binaries.length} Chromium binaries with ldd`);
if (missing.length) {
	console.error(`e2e-libs: still not found: ${missing.join(", ")}`);
}
console.log(`export LD_LIBRARY_PATH=${ldPath}`);
process.exit(missing.length || failed.length ? 1 : 0);
