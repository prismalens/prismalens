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

function gitOut(args) {
	try {
		return execFileSync("git", args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (err) {
		const stderr = (err.stderr?.toString() ?? "").trim();
		const detail = stderr ? `\n    ${stderr.split("\n").join("\n    ")}` : "";
		throw new Error(
			`git ${args.join(" ")} — exit ${err.status ?? err.code ?? "?"}${detail}`,
		);
	}
}

function headBranch() {
	if (process.env.GITHUB_HEAD_REF) return process.env.GITHUB_HEAD_REF;
	try {
		return gitOut(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
	} catch {
		return "(unknown)";
	}
}

// Fails closed: an unreadable diff must never look like an empty one, or the
// gate goes quietly green (#328). Only an empty repo is a legitimate no-diff.
function getChangedFiles(baseRef) {
	const untracked = gitOut(["ls-files", "--others", "--exclude-standard"])
		.trim()
		.split("\n")
		.filter(Boolean);

	let hasCommits = true;
	try {
		gitOut(["rev-parse", "--verify", "HEAD"]);
	} catch {
		hasCommits = false;
	}
	if (!hasCommits) {
		return { files: [...new Set(untracked)], mergeBase: null, empty: true };
	}

	if (!baseRef) {
		throw new Error(
			"no base ref could be resolved (tried --base/--since, $BASE_REF, " +
				"$GITHUB_BASE_REF, origin/main, main, origin/master, master)",
		);
	}
	const mergeBase = gitOut(["merge-base", "HEAD", baseRef]).trim();
	const diff = gitOut(["diff", "--name-only", mergeBase])
		.trim()
		.split("\n")
		.filter(Boolean);

	return {
		files: [...new Set([...diff, ...untracked])],
		mergeBase,
		empty: false,
	};
}

function isChangesetFile(filePath) {
	const f = filePath.replace(/\\/g, "/");
	return (
		f.startsWith(".changeset/") &&
		f.endsWith(".md") &&
		!f.toLowerCase().endsWith("readme.md")
	);
}

const DEP_FIELDS = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
];
// A range, not an alias/tarball/git target: `1.2.3`, `^1.2`, `workspace:*`.
const VERSION_RANGE = /^(workspace:)?[*^~<>=\d]/;

function isVersionOnlyManifestEdit(filePath, mergeBase) {
	if (!/(^|\/)package\.json$/.test(filePath)) return false;
	let before;
	let after;
	try {
		before = JSON.parse(gitOut(["show", `${mergeBase}:${filePath}`]));
		after = readJson(join(repoRoot, filePath));
	} catch {
		return false;
	}
	for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (key === "version") continue;
		const b = before[key];
		const a = after[key];
		if (DEP_FIELDS.includes(key)) {
			for (const dep of new Set([
				...Object.keys(b ?? {}),
				...Object.keys(a ?? {}),
			])) {
				if (typeof b?.[dep] !== "string" || typeof a?.[dep] !== "string") {
					return false;
				}
				if (b[dep] !== a[dep] && !VERSION_RANGE.test(a[dep])) return false;
			}
			continue;
		}
		if (JSON.stringify(b) !== JSON.stringify(a)) return false;
	}
	return true;
}

const argv = process.argv.slice(2);
const getArg = (name) => {
	const i = argv.indexOf(name);
	return i === -1 ? null : argv[i + 1];
};
const baseArg = getArg("--base") ?? getArg("--since");

const baseRef = resolveBaseRef(baseArg);

let probe;
try {
	probe = getChangedFiles(baseRef);
} catch (err) {
	console.error(
		"Could not determine which files changed — refusing to pass.\n",
	);
	console.error(`  base ref: ${baseRef ?? "(unresolved)"}`);
	console.error(`  ${err.message}\n`);
	console.error(
		"Why this is fatal:\n" +
			"  This gate is only meaningful if the diff is known. An empty file list from a\n" +
			"  broken git invocation is indistinguishable from a branch that changed nothing,\n" +
			"  so it would pass silently forever — the exact hole issue #328 exists to close.\n",
	);
	console.error(
		"How to fix:\n" +
			"  1. In CI: check out with full history — `fetch-depth: 0` on actions/checkout.\n" +
			"     A shallow clone shares no merge-base with the base branch.\n" +
			"  2. Locally: fetch the base branch (`git fetch origin main`), or name one:\n" +
			"       node scripts/validate-changesets.mjs --base <ref>\n",
	);
	process.exit(1);
}

const changedFiles = probe.files;
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
let releaseExemption = null;

// 1. Presence check
if (changedPublishable.length > 0 && !changesetInDiff) {
	// The release PR deletes every consumed changeset and can never run
	// `changeset --empty`, so it is exempt — recognised by diff shape, not branch
	// name. See CONTRIBUTING.md → "Release PRs are exempt…" (#328).
	const consumed = probe.mergeBase
		? changedFiles.filter(
				(f) => isChangesetFile(f) && !existsSync(join(repoRoot, f)),
			)
		: [];
	const notVersionOnly = consumed.length
		? changedPublishable.filter(
				(f) => !isVersionOnlyManifestEdit(f, probe.mergeBase),
			)
		: changedPublishable;

	if (consumed.length > 0 && notVersionOnly.length === 0) {
		releaseExemption = { consumed };
		console.log(
			"changeset presence check skipped — this is a Version Packages release PR:",
		);
		console.log(
			`  • it consumes ${consumed.length} changeset(s): ${consumed.join(", ")}`,
		);
		console.log(
			`  • every changed publishable file is a version-field-only package.json: ${changedPublishable.join(", ")}`,
		);
		console.log(`  • branch: ${headBranch()}`);
		console.log(
			'  See CONTRIBUTING.md → "Release PRs are exempt from the presence check".\n',
		);
	} else {
		hasError = true;
		console.error("No changeset found for changes to publishable packages.\n");
		console.error("Changed publishable files:");
		for (const f of changedPublishable.slice(0, 10)) {
			console.error(`  • ${f}`);
		}
		if (changedPublishable.length > 10) {
			console.error(`  ... and ${changedPublishable.length - 10} more`);
		}
		if (consumed.length > 0) {
			console.error(
				`\nThis branch deletes ${consumed.length} changeset(s) the way a release PR does, but the ` +
					`release-PR exemption does not apply: ${notVersionOnly.length} changed file(s) under packages/ ` +
					"are not version-field-only package.json edits:",
			);
			for (const f of notVersionOnly.slice(0, 10)) {
				console.error(`  ✗ ${f}`);
			}
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

if (releaseExemption) {
	console.log(
		`changesets OK — release PR exempt from the presence check; ${files.length} changeset(s) validated.`,
	);
} else if (probe.empty) {
	console.log(
		`changesets OK — repository has no commits yet, so there is no diff to check; ${files.length} changeset(s) validated.`,
	);
} else if (changedPublishable.length === 0 && files.length === 0) {
	console.log(
		`changesets OK — no publishable packages modified; 0 changeset(s) required.`,
	);
} else {
	console.log(
		`changesets OK — ${files.length} changeset(s) validated; publishable set: ${allowed}.`,
	);
}
