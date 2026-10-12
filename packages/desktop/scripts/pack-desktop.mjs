#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Stage the packed `prismalens` package as resources/prismalens.asar, installed
 * the way a user's `npm install -g prismalens` lays it out, so the launcher runs
 * exactly the artifact the npm channel ships (the invariant on #83: one server,
 * two distribution channels).
 *
 * One archive, not ~20k loose files: Explorer's Extract All failed on paths past
 * MAX_PATH and the app lost a migration (#673 w53). Electron-as-Node reads the
 * asar; the native `.node` files sit unpacked beside it.
 */

import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPackageWithOptions } from "@electron/asar";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "../../..");
const resources = resolve(here, "../resources");
const asar = join(resources, "prismalens.asar");
const tmp = mkdtempSync(join(tmpdir(), "pl-desktop-"));

execFileSync(
	"node",
	[join(repoRoot, "scripts/pack-cli.mjs"), "--skip-build", "--out", tmp],
	{
		stdio: "inherit",
	},
);
const tarball = readdirSync(tmp).find((f) => f.endsWith(".tgz"));
if (!tarball) throw new Error(`pack-cli.mjs produced no tarball in ${tmp}`);

// `npm install -g` into a prefix resolves the tarball's bundled dependencies the
// way a global install does. On Windows npm is `npm.cmd`, which Node will not
// spawn without a shell.
const prefix = join(tmp, "prefix");
const npm =
	process.platform === "win32"
		? { command: "cmd.exe", prefix: ["/d", "/c", "npm"] }
		: { command: "npm", prefix: [] };
execFileSync(
	npm.command,
	[
		...npm.prefix,
		"install",
		"-g",
		"--prefix",
		prefix,
		"--no-audit",
		"--no-fund",
		join(tmp, tarball),
	],
	{ stdio: "inherit" },
);
// No @electron/rebuild: better-sqlite3 13's prebuild is N-API, so the copy npm
// installed loads under Electron's Node ABI as it is (#762).

// POSIX puts a global install under lib/node_modules, Windows under node_modules.
const pkg = [
	join(prefix, "lib", "node_modules", "prismalens"),
	join(prefix, "node_modules", "prismalens"),
].find((p) => existsSync(p));
if (!pkg) throw new Error(`npm installed no prismalens under ${prefix}`);

addLicences(join(pkg, "node_modules"));
const pruned = prune(join(pkg, "node_modules"));
assertLicences(join(pkg, "node_modules"));

// The package sits one level down in the archive: electron-builder drops a
// top-level node_modules from extraResources, and the unpacked tree mirrors it.
const root = join(tmp, "asar-root");
mkdirSync(root);
renameSync(pkg, join(root, "prismalens"));
rmSync(resources, { recursive: true, force: true });
await createPackageWithOptions(root, asar, { unpack: "*.node" });
rmSync(tmp, { recursive: true, force: true });
console.log(
	`staged ${asar} (${(statSync(asar).size / 1e6).toFixed(0)} MB; pruned ${pruned} files)`,
);

function sources() {
	const file = resolve(here, "../licences/sources.json");
	return Object.keys(JSON.parse(readFileSync(file, "utf8")));
}

function hasLicence(dir) {
	return readdirSync(dir).some((f) => /^licen[cs]e/i.test(f));
}

/** Upstream licence texts for installed packages that ship none (licences/sources.json, #829). */
function addLicences(nodeModules) {
	for (const name of sources()) {
		const target = join(nodeModules, name);
		if (!existsSync(join(target, "package.json")))
			throw new Error(`${name} is not installed; drop it from licences/`);
		if (hasLicence(target)) continue;
		copyFileSync(
			resolve(here, "../licences", name, "LICENSE"),
			join(target, "LICENSE"),
		);
	}
}

/** Fails the build when the prune removed a licence text the asar must carry. */
function assertLicences(nodeModules) {
	const missing = sources().filter((n) => !hasLicence(join(nodeModules, n)));
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const path = join(dir, entry.name);
			if (entry.name.startsWith("@")) walk(path);
			else {
				const pointer = licencePointer(path);
				if (pointer && !existsSync(join(path, pointer)))
					missing.push(`${entry.name}/${pointer}`);
				if (existsSync(join(path, "node_modules")))
					walk(join(path, "node_modules"));
			}
		}
	};
	walk(nodeModules);
	if (missing.length > 0)
		throw new Error(
			`the desktop build lost licence texts: ${missing.join(", ")}`,
		);
}

/**
 * Drop what no running server reads: source maps, type declarations and
 * TypeScript sources, Markdown, each package's own tests, docs and examples,
 * and native prebuilds for other platforms. Licence files stay, with
 * THIRD_PARTY_LICENSES/ and the file a `SEE LICENSE IN` field names.
 */
function prune(nodeModules) {
	// npm installs every platform's prebuild; the app runs on the one building it (#673 walk 4).
	const own = [`${process.platform}-${process.arch}`];
	if (process.platform === "linux") own.push(`linuxmusl-${process.arch}`);
	const foreign = (name) =>
		!own.some((t) => name === t || name.startsWith(`${t}.`));
	const FILES = /\.(map|ts|mts|cts|md|markdown)$/i;
	const DIRS = new Set([
		"test",
		"tests",
		"__tests__",
		"docs",
		"example",
		"examples",
		"benchmark",
		"benchmarks",
		".github",
	]);
	let count = 0;
	const pruneModules = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const path = join(dir, entry.name);
			if (entry.name.startsWith("@")) pruneModules(path);
			else prunePackage(path, true);
		}
	};
	const prunePackage = (dir, root) => {
		const keep = root ? licencePointer(dir) : undefined;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "THIRD_PARTY_LICENSES") continue;
				if (entry.name === "node_modules") pruneModules(path);
				else if (root && entry.name === "prebuilds") {
					for (const name of readdirSync(path).filter(foreign)) {
						const p = join(path, name);
						count += statSync(p).isDirectory() ? countFiles(p) : 1;
						rmSync(p, { recursive: true, force: true });
					}
				}
				// Only a package's own top-level dirs: a nested `docs` can be code.
				else if (root && DIRS.has(entry.name)) {
					count += countFiles(path);
					rmSync(path, { recursive: true, force: true });
				} else prunePackage(path, false);
			} else if (
				FILES.test(entry.name) &&
				!/^licen[cs]e/i.test(entry.name) &&
				entry.name !== keep
			) {
				rmSync(path, { force: true });
				count += 1;
			}
		}
	};
	pruneModules(nodeModules);
	return count;
}

function licencePointer(dir) {
	try {
		const { license } = JSON.parse(
			readFileSync(join(dir, "package.json"), "utf8"),
		);
		return /^SEE LICEN[CS]E IN (.+)$/i.exec(license ?? "")?.[1];
	} catch {
		return undefined;
	}
}

function countFiles(dir) {
	let n = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		n += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1;
	}
	return n;
}
