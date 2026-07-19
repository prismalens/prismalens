#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
//
// validate-changesets.mjs — fail a PR when a changeset names a package that is
// not a publishable workspace package.
//
// Why this exists: the release job runs `changeset version`, which HARD-THROWS
// on a changeset referencing a package that is not in the workspace (e.g.
// `@prismalens/cli`, which is not a package — the CLI publishes as `prismalens`).
// That throw only happens on push-to-main, so a bad name sails through review and
// silently stalls every release until someone notices the Version PR never
// appeared (issue #178: broken 2026-07-12 → 2026-07-19). This guard moves the
// failure left onto the PR that introduces the changeset (issue #187).
//
// The rule (post-#193): there is exactly one publishable package — `prismalens`.
// The whole @prismalens/* closure is `private: true` and bundled into the CLI
// tarball, so it must never appear in a changeset (see .changeset/README.md). A
// changeset may name only a package that is (a) in the workspace, (b) not
// private, and (c) not in .changeset/config.json "ignore". Anything else — a
// non-workspace name, a private/bundled package, or an ignored app package —
// fails here, before it can reach the release job.
//
// Zero-dependency (Node built-ins only) so CI can run it without `pnpm install`.
//
//   node scripts/validate-changesets.mjs

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// Workspace globs from pnpm-workspace.yaml: packages/* and packages/@prismalens/*.
// One level under each root; a directory without a package.json (e.g. the
// `@prismalens` scope dir itself) is simply skipped.
const workspace = new Map(); // name -> { private: boolean }
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

// Publishable = in the workspace, not private, not ignored — exactly what
// `changeset version` will accept. Today that set is { prismalens }.
const publishable = new Set();
for (const [n, meta] of workspace) {
	if (!meta.private && !ignore.has(n)) publishable.add(n);
}

// Extract the "pkg": bump lines from a changeset's YAML frontmatter block.
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

const dir = join(repoRoot, ".changeset");
const files = readdirSync(dir).filter(
	(f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md",
);

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
	process.exit(1);
}

console.log(
	`changesets OK — ${files.length} changeset(s) validated; publishable set: ${allowed}.`,
);
