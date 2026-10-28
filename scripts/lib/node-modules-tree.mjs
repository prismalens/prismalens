// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Shared by the desktop staging and the standalone archive: what a shipped node_modules
// tree keeps, and the licence text every package in it must carry (#830, #906).

import {
	copyFileSync,
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { join } from "node:path";

const LICENCE = /^(licen[cs]e|copying)/i;

function sources(licencesDir) {
	return Object.keys(
		JSON.parse(readFileSync(join(licencesDir, "sources.json"), "utf8")),
	);
}

function hasLicence(dir) {
	return readdirSync(dir).some((f) => LICENCE.test(f));
}

export function licencePointer(dir) {
	try {
		const { license } = JSON.parse(
			readFileSync(join(dir, "package.json"), "utf8"),
		);
		return /^SEE LICEN[CS]E IN (.+)$/i.exec(license ?? "")?.[1];
	} catch {
		return undefined;
	}
}

export function countFiles(dir) {
	let n = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		n += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1;
	}
	return n;
}

/** Upstream licence texts for installed packages that ship none (`<licencesDir>/sources.json`, #829). */
export function addLicences(nodeModules, licencesDir) {
	for (const name of sources(licencesDir)) {
		const target = join(nodeModules, name);
		if (!existsSync(join(target, "package.json")))
			throw new Error(`${name} is not installed; drop it from licences/`);
		if (hasLicence(target)) continue;
		copyFileSync(join(licencesDir, name, "LICENSE"), join(target, "LICENSE"));
	}
}

/** Fails the build when the prune removed a licence text the tree must carry. */
export function assertLicences(nodeModules, licencesDir) {
	const missing = sources(licencesDir).filter(
		(n) => !hasLicence(join(nodeModules, n)),
	);
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
		throw new Error(`the build lost licence texts: ${missing.join(", ")}`);
}

/**
 * Every package under any node_modules in `root` that carries no licence text: a
 * LICENSE/COPYING file, the file its `SEE LICENSE IN` names, or (first party) the root
 * LICENSE. A package holding dist/adapters/bundled.json must also carry
 * THIRD_PARTY_LICENSES/<name>/ for every package it inlines.
 */
export function missingLicences(root) {
	const missing = [];
	const checkBundled = (dir) => {
		const manifest = join(dir, "dist", "adapters", "bundled.json");
		if (!existsSync(manifest)) return;
		for (const { inlined } of Object.values(
			JSON.parse(readFileSync(manifest, "utf8")),
		)) {
			for (const id of inlined) {
				const name = id.slice(0, id.lastIndexOf("@"));
				const texts = join(dir, "THIRD_PARTY_LICENSES", ...name.split("/"));
				if (!existsSync(texts) || readdirSync(texts).length === 0)
					missing.push(`${id} (inlined in ${dir})`);
			}
		}
	};
	const checkPackage = (dir) => {
		let manifest;
		try {
			manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
		} catch {
			return;
		}
		if (!manifest.name) return;
		checkBundled(dir);
		if (manifest.name.startsWith("@prismalens/")) return;
		const pointer = licencePointer(dir);
		if (pointer ? existsSync(join(dir, pointer)) : hasLicence(dir)) return;
		missing.push(`${manifest.name}@${manifest.version} (${dir})`);
	};
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const path = join(dir, entry.name);
			if (entry.name === "node_modules") {
				for (const pkg of readdirSync(path, { withFileTypes: true })) {
					if (!pkg.isDirectory() || pkg.name.startsWith(".")) continue;
					const pkgPath = join(path, pkg.name);
					const children = pkg.name.startsWith("@")
						? readdirSync(pkgPath, { withFileTypes: true })
								.filter((d) => d.isDirectory())
								.map((d) => join(pkgPath, d.name))
						: [pkgPath];
					for (const child of children) {
						checkPackage(child);
						walk(child);
					}
				}
			} else walk(path);
		}
	};
	checkBundled(root);
	walk(root);
	return missing;
}

/** Package dirs npm created but left empty: a bundled package's peer it never filled (#906). */
export function hollowPackages(root) {
	const hollow = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const path = join(dir, entry.name);
			if (entry.name !== "node_modules") {
				walk(path);
				continue;
			}
			for (const pkg of readdirSync(path, { withFileTypes: true })) {
				if (!pkg.isDirectory() || pkg.name.startsWith(".")) continue;
				const pkgPath = join(path, pkg.name);
				const children = pkg.name.startsWith("@")
					? readdirSync(pkgPath).map((n) => join(pkgPath, n))
					: [pkgPath];
				for (const child of children) {
					if (!existsSync(join(child, "package.json"))) hollow.push(child);
					else walk(child);
				}
			}
		}
	};
	walk(root);
	return hollow;
}

/**
 * Drop what no running server reads: source maps, debug symbols (.pdb), type
 * declarations and TypeScript sources, Markdown, each package's own tests, docs and examples,
 * and native prebuilds for other platforms. Licence files stay, with
 * THIRD_PARTY_LICENSES/ and the file a `SEE LICENSE IN` field names.
 */
export function prune(nodeModules) {
	// npm installs every platform's prebuild; the app runs on the one building it (#673 walk 4).
	const own = [`${process.platform}-${process.arch}`];
	if (process.platform === "linux") own.push(`linuxmusl-${process.arch}`);
	const foreign = (name) =>
		!own.some((t) => name === t || name.startsWith(`${t}.`));
	const FILES = /\.(map|ts|mts|cts|md|markdown|pdb)$/i;
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
					prunePackage(path, false);
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
