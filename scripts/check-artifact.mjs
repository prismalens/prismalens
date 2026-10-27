#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Gate one release artifact: its deepest path under every Windows install prefix it
 * lands in, its bytes and file count against scripts/artifact-budgets.json, and a
 * licence text for every package it carries (#906).
 *
 *   node scripts/check-artifact.mjs <file.tgz|file.tar.gz|file.zip> [--budgets <json>]
 *
 * The limit is 260 - 40 for a 20-char username: the margin keeps the next deeper
 * dependency or migration folder from reaching MAX_PATH on a default Windows box.
 */

import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { missingLicences } from "./lib/node-modules-tree.mjs";

export const LIMIT = 220;
const U = "u".repeat(20);
const HOME = `C:\\Users\\${U}`;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const win = (entry) => entry.split("/").join("\\");

/** Where each Windows install channel puts the artifact's entries, as [model, prefix, entry]. */
export function pathModels({ kind, name, version, top }, entries) {
	const models = [];
	for (const entry of entries) {
		if (kind === "npm") {
			const rel = entry.replace(/^package\//, "");
			models.push([
				"npm-global",
				`${HOME}\\AppData\\Roaming\\npm\\node_modules\\${win(name)}\\`,
				rel,
			]);
			// The standalone archive is this tree relocated to app/ (scripts/build-standalone.mjs).
			if (name === "prismalens") {
				models.push([
					"installer",
					`${HOME}\\AppData\\Local\\prismalens\\runtime\\${version}\\`,
					`app/${rel}`,
				]);
				models.push([
					"scoop",
					`${HOME}\\scoop\\apps\\prismalens\\${version}\\_tmp\\`,
					`prismalens-${version}-win32-x64/app/${rel}`,
				]);
			}
		} else {
			// install.ps1 unpacks without the top dir; Scoop's extract_dir unpacks into _tmp (#905).
			models.push([
				"installer",
				`${HOME}\\AppData\\Local\\prismalens\\runtime\\${version}\\`,
				entry.slice(top.length + 1),
			]);
			models.push([
				"scoop",
				`${HOME}\\scoop\\apps\\prismalens\\${version}\\_tmp\\`,
				entry,
			]);
		}
	}
	const deepest = new Map();
	for (const [model, prefix, entry] of models) {
		const length = prefix.length + entry.length;
		if (!deepest.has(model) || deepest.get(model).length < length)
			deepest.set(model, { model, prefix, entry: win(entry), length });
	}
	return [...deepest.values()];
}

/** The budget key and install-model inputs of an artifact, from its file name and contents. */
export function describe(file, root) {
	const pkgJson = join(root, "package", "package.json");
	if (existsSync(pkgJson)) {
		const { name, version } = JSON.parse(readFileSync(pkgJson, "utf8"));
		return { kind: "npm", key: name, name, version, top: "package" };
	}
	const match =
		/^prismalens-(.+)-((?:linux|darwin|win32)-(?:x64|arm64))\.(?:zip|tar\.gz)$/.exec(
			basename(file),
		);
	if (!match)
		throw new Error(`${basename(file)} is not an artifact this checks`);
	const top = `prismalens-${match[1]}-${match[2]}`;
	if (!existsSync(join(root, top)))
		throw new Error(`${basename(file)} has no top-level ${top}/`);
	return { kind: "standalone", key: match[2], version: match[1], top };
}

function extract(file, into) {
	if (/\.(tgz|tar\.gz)$/.test(file)) {
		// Relative, from its folder: GNU tar (Git Bash) reads `C:\...` as a remote host.
		execFileSync("tar", ["-xzf", basename(file), "-C", into], {
			cwd: dirname(file),
		});
	} else if (file.endsWith(".zip")) {
		if (process.platform !== "win32")
			throw new Error("zip check runs on Windows");
		// Windows' own bsdtar reads zips; Git Bash's GNU tar, first on PATH in CI, does not.
		execFileSync("C:\\Windows\\System32\\tar.exe", ["-xf", file, "-C", into]);
	} else throw new Error(`${file}: not a .tgz, .tar.gz or .zip`);
}

function files(root) {
	const out = [];
	const walk = (dir) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else out.push(relative(root, p).split(sep).join("/"));
		}
	};
	walk(root);
	return out;
}

export function checkArtifact(file, budgets) {
	const problems = [];
	const lines = [];
	const root = mkdtempSync(join(tmpdir(), "pl-artifact-"));
	try {
		extract(resolve(file), root);
		const info = describe(file, root);
		const entries = files(root);
		for (const { model, prefix, entry, length } of pathModels(info, entries)) {
			lines.push(`${model} ${length}/${LIMIT} ${prefix} + ${entry}`);
			if (length > LIMIT)
				problems.push(
					`${model}: ${length} chars is over ${LIMIT} for a 20-char username: ${prefix}${entry}`,
				);
		}
		const bytes = statSync(file).size;
		const budget = budgets[info.key];
		lines.push(
			`${info.key} ${bytes} bytes, ${entries.length} files (budget ${budget ? `${budget.bytes} bytes, ${budget.files} files` : "none"})`,
		);
		if (!budget) problems.push(`no budget for ${info.key} in the budget file`);
		else {
			if (bytes > budget.bytes)
				problems.push(
					`${info.key}: ${bytes} bytes is over its budget of ${budget.bytes}`,
				);
			if (entries.length > budget.files)
				problems.push(
					`${info.key}: ${entries.length} files is over its budget of ${budget.files}`,
				);
		}
		// An npm tarball's own bundled.json sits under package/, which the node_modules walk skips.
		const missing = missingLicences(
			info.kind === "npm" ? join(root, info.top) : root,
		);
		lines.push(
			`licences: ${missing.length === 0 ? "every package carries one" : `${missing.length} missing`}`,
		);
		for (const m of missing) problems.push(`no licence text: ${m}`);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
	return { lines, problems };
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			budgets: {
				type: "string",
				default: join(ROOT, "scripts", "artifact-budgets.json"),
			},
		},
	});
	if (positionals.length === 0) {
		console.error("usage: check-artifact.mjs <artifact>... [--budgets <json>]");
		process.exit(2);
	}
	const budgets = JSON.parse(readFileSync(values.budgets, "utf8"));
	let failed = false;
	for (const file of positionals) {
		console.log(`==> ${basename(file)}`);
		const { lines, problems } = checkArtifact(file, budgets);
		for (const l of lines) console.log(`  ${l}`);
		for (const p of problems) console.log(`::error::${basename(file)}: ${p}`);
		failed ||= problems.length > 0;
	}
	process.exit(failed ? 1 : 0);
}
