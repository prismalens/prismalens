#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Changesets are required for publishable runtime changes under packages/* (see
// scripts/pack-cli.mjs), while private packages (@prismalens/*) are rejected (#193).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// Workspace globs from pnpm-workspace.yaml: packages/* and packages/@prismalens/*.
const workspace = new Map();
for (const root of ["packages", join("packages", "@prismalens")]) {
	const abs = join(repoRoot, root);
	if (!existsSync(abs)) continue;
	for (const entry of readdirSync(abs, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const manifest = join(abs, entry.name, "package.json");
		if (!existsSync(manifest)) continue;
		const pkg = readJson(manifest);
		if (pkg.name) workspace.set(pkg.name, { private: pkg.private === true });
	}
}

const ignore = new Set(
	readJson(join(repoRoot, ".changeset", "config.json")).ignore ?? [],
);

const publishable = new Set();
for (const [n, meta] of workspace) {
	if (!meta.private && !ignore.has(n)) publishable.add(n);
}

function packagesIn(md) {
	const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!fm) return [];
	const names = [];
	for (const line of fm[1].split(/\r?\n/)) {
		const m = line.match(
			/^\s*["']?(@?[^"'\s:]+(?:\/[^"'\s:]+)?)["']?\s*:\s*(major|minor|patch)\s*$/,
		);
		if (m) names.push(m[1]);
	}
	return names;
}

function isPublishableFile(filePath) {
	const normalized = filePath.replace(/\\/g, "/");
	if (!normalized.startsWith("packages/")) return false;
	if (normalized.endsWith(".md")) return false;
	if (
		/\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized) ||
		normalized.includes("/__tests__/") ||
		normalized.includes("/e2e/") ||
		normalized.includes("/eval/") ||
		/(^|\/)vitest\.config\.[cm]?[jt]s$/.test(normalized) ||
		/(^|\/)playwright\.config\.[cm]?[jt]s$/.test(normalized)
	) {
		return false;
	}
	return true;
}

function resolveBaseRef(explicit) {
	if (explicit) return explicit;
	if (process.env.BASE_REF) return process.env.BASE_REF;
	if (process.env.GITHUB_BASE_REF) {
		const remoteBase = `origin/${process.env.GITHUB_BASE_REF}`;
		try {
			execFileSync("git", ["rev-parse", "--verify", remoteBase], {
				stdio: "ignore",
			});
			return remoteBase;
		} catch {
			return process.env.GITHUB_BASE_REF;
		}
	}
	for (const candidate of ["origin/main", "main", "origin/master", "master"]) {
		try {
			execFileSync("git", ["rev-parse", "--verify", candidate], {
				stdio: "ignore",
			});
			return candidate;
		} catch {}
	}
	return null;
}

function getChangedFiles(baseRef) {
	if (!baseRef) return [];
	try {
		let mergeBase;
		try {
			mergeBase = execFileSync("git", ["merge-base", "HEAD", baseRef], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
		} catch {
			mergeBase = baseRef;
		}
		const diff = execFileSync("git", ["diff", "--name-only", mergeBase], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		})
			.trim()
			.split("\n")
			.filter(Boolean);

		const untracked = execFileSync(
			"git",
			["ls-files", "--others", "--exclude-standard"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		)
			.trim()
			.split("\n")
			.filter(Boolean);

		return [...new Set([...diff, ...untracked])];
	} catch {
		return [];
	}
}

const argv = process.argv.slice(2);
const getArg = (name) => {
	const i = argv.indexOf(name);
	return i === -1 ? null : argv[i + 1];
};
const baseArg = getArg("--base") ?? getArg("--since");

const baseRef = resolveBaseRef(baseArg);
const changedFiles = getChangedFiles(baseRef);
const changedPublishable = changedFiles.filter(isPublishableFile);

const dir = join(repoRoot, ".changeset");
const files = existsSync(dir)
	? readdirSync(dir).filter(
			(f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md",
		)
	: [];

const changesetInDiff = changedFiles.some(
	(f) =>
		f.startsWith(".changeset/") &&
		f.endsWith(".md") &&
		!f.toLowerCase().endsWith("readme.md") &&
		existsSync(join(repoRoot, f)),
);

let hasError = false;

// 1. Presence check
if (changedPublishable.length > 0 && !changesetInDiff) {
	hasError = true;
	console.error("No changeset found for changes to publishable packages.\n");
	console.error("Changed publishable files:");
	for (const f of changedPublishable.slice(0, 10)) {
		console.error(`  • ${f}`);
	}
	if (changedPublishable.length > 10) {
		console.error(`  ... and ${changedPublishable.length - 10} more`);
	}
	console.error(
		"\nWhy this is required:\n" +
			"  This branch modifies code or assets that ship in the `prismalens` npm package.\n" +
			"  Every user-facing change to publishable code must carry a release note so the\n" +
			"  release train (issue #328) can version and publish the package.\n",
	);
	console.error(
		"How to fix:\n" +
			'  1. Add a changeset naming "prismalens" (patch for bug fixes, minor for features):\n' +
			"       pnpm exec changeset\n" +
			"     (or: npx changeset)\n\n" +
			"  2. Or if this change genuinely needs no release note (e.g. internal refactor),\n" +
			"     add an empty changeset escape hatch:\n" +
			"       pnpm exec changeset --empty\n" +
			"     (or: npx changeset --empty)\n",
	);
}

// 2. Name validation
const problems = [];
for (const file of files) {
	for (const name of packagesIn(readFileSync(join(dir, file), "utf8"))) {
		if (publishable.has(name)) continue;
		let reason;
		if (!workspace.has(name)) reason = "not a workspace package";
		else if (workspace.get(name).private)
			reason = "private — bundled into prismalens, never published (#193)";
		else if (ignore.has(name))
			reason = 'listed in .changeset/config.json "ignore"';
		else reason = "not a publishable package";
		problems.push({ file, name, reason });
	}
}

const allowed = [...publishable].sort().join(", ") || "(none)";
if (problems.length) {
	hasError = true;
	console.error("Invalid package name(s) in changeset(s):\n");
	for (const p of problems)
		console.error(`  ✗ .changeset/${p.file}: "${p.name}" — ${p.reason}`);
	console.error(
		`\nA changeset may only name a publishable package: ${allowed}.`,
	);
	console.error(
		'The @prismalens/* closure is bundled into the prismalens CLI (#193) — name "prismalens" even when the\n' +
			"change lives in engine/config/contracts. See .changeset/README.md.",
	);
}

if (hasError) {
	process.exit(1);
}

if (changedPublishable.length === 0 && files.length === 0) {
	console.log(
		`changesets OK — no publishable packages modified; 0 changeset(s) required.`,
	);
} else {
	console.log(
		`changesets OK — ${files.length} changeset(s) validated; publishable set: ${allowed}.`,
	);
}
