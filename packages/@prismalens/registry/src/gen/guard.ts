// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawnSync } from "node:child_process";
import { existsSync, globSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, posix, relative } from "node:path";
import { parse } from "yaml";
import { countText, lintFacts } from "../ratchet.ts";
import { readForbidden } from "./extract.ts";
import { familyIds } from "./ids.ts";
import { holdTsv } from "./ratchet-run.ts";
import type { Workspace } from "./workspace.ts";

export const PACKAGES_FILE = "pnpm-workspace.yaml";

const TEST = /\.(?:test|spec)\.tsx?$/;
// Build output, git-ignored: a checkout that has built must count what a fresh one counts.
const SKIP_DIR = new Set(["node_modules", "dist", "coverage", "generated"]);

const toPosix = (p: string) => p.split("\\").join("/");

/** The package globs a `pnpm-workspace.yaml` lists. */
export const packageGlobs = (text: string): string[] =>
	(parse(text) as { packages?: string[] } | null)?.packages ?? [];

/** Every workspace package's repo-relative dir, so a package added later is covered with no edit. */
export function guardPackages(root: string): string[] {
	const file = join(root, PACKAGES_FILE);
	const globs = existsSync(file)
		? packageGlobs(readFileSync(file, "utf8"))
		: [];
	const found = (g: string) =>
		globSync(`${g}/package.json`, { cwd: root }).map((f) =>
			posix.dirname(toPosix(f)),
		);
	const dropped = new Set(
		globs.filter((g) => g.startsWith("!")).flatMap((g) => found(g.slice(1))),
	);
	return Array.from(
		new Set(globs.filter((g) => !g.startsWith("!")).flatMap(found)),
	)
		.filter((d) => !dropped.has(d) && !d.includes("node_modules"))
		.sort();
}

/** A package's hand-written TypeScript: no dependencies, build output or generated files. */
function sources(root: string, dir: string): string[] {
	return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => {
		const at = posix.join(dir, e.name);
		if (e.isDirectory())
			return e.name.startsWith(".") || SKIP_DIR.has(e.name)
				? []
				: sources(root, at);
		return /\.tsx?$/.test(e.name) && !/\.(?:gen\.tsx?|d\.ts)$/.test(e.name)
			? [at]
			: [];
	});
}

/** The dirs a host's own ratchet already measures. */
const measured = (ws: Workspace): string[] =>
	ws.hosts
		.filter((h) => h.ratchet)
		.flatMap((h) =>
			(h.ratchetDirs ?? [h.src]).map((d) =>
				posix.join(toPosix(relative(ws.root, h.root)), d),
			),
		);

/** Counts the guard's facts over every package file no host ratchet measures. */
export function measureGuard(ws: Workspace): {
	facts: Map<string, number>;
	problems: string[];
} {
	const guard = ws.guard;
	const facts = new Map<string, number>();
	if (!guard) return { facts, problems: [] };
	const fail = (problems: string[]) => ({ facts, problems });
	const packages = guardPackages(ws.root);
	if (!packages.length)
		return fail([
			`[workspace/guard] ${PACKAGES_FILE} matches no package, so the guard would scan nothing. Fix: restore its packages list.`,
		]);
	const skip = measured(ws);
	const files = new Set(
		packages
			.flatMap((p) => sources(ws.root, p))
			.filter((f) => !skip.some((d) => f.startsWith(`${d}/`))),
	);
	const { ids, problems } = familyIds(ws, guard.forbid ?? []);
	if (problems.length) return fail(problems);
	for (const f of files) {
		const text = readFileSync(join(ws.root, f), "utf8");
		countText(facts, f, text);
		if (TEST.test(f)) continue;
		for (const { rule, count } of readForbidden(
			f,
			text,
			guard.forbid ?? [],
			ids,
		))
			facts.set(`${f}\t${rule}`, count);
	}
	const biome = createRequire(import.meta.url).resolve(
		"@biomejs/biome/bin/biome",
	);
	const run = spawnSync(
		process.execPath,
		[
			biome,
			"lint",
			...packages,
			`--config-path=${guard.lint}`,
			"--reporter=json",
			"--max-diagnostics=none",
		],
		{
			windowsHide: true,
			cwd: ws.root,
			encoding: "utf8",
			maxBuffer: 512 * 1024 * 1024,
		},
	);
	const at = run.stdout.indexOf('{"summary"');
	if (at < 0)
		return fail([
			`[workspace/guard] biome lint with ${guard.lint} wrote no JSON report: ${run.stderr.trim()}`,
		]);
	const report = JSON.parse(run.stdout.slice(at)) as Parameters<
		typeof lintFacts
	>[0];
	const toFile = (f: string) =>
		toPosix(isAbsolute(f) ? relative(ws.root, f) : f);
	// A file the lint cannot parse reports no rule hits, so it would pass unread.
	const unread = report.diagnostics
		.filter((d) => d.category === "parse")
		.map((d) => toFile(d.location?.path ?? ""))
		.filter((f) => files.has(f));
	if (unread.length)
		return fail(
			Array.from(new Set(unread)).map(
				(f) =>
					`[workspace/guard] ${f} does not parse under ${guard.lint}. Fix: correct the file, or the lint config's parser options.`,
			),
		);
	const lint = new Map<string, number>();
	lintFacts(report, toFile, lint);
	for (const [k, n] of lint)
		if (files.has(k.slice(0, k.indexOf("\t"))))
			facts.set(k, (facts.get(k) ?? 0) + n);
	return { facts, problems: [] };
}

/** The workspace guard's ratchet: today's facts against its TSV, or written with `write`. */
export function ratchetGuard(ws: Workspace, write: boolean): string[] {
	const guard = ws.guard;
	if (!guard) return [];
	const { facts, problems } = measureGuard(ws);
	if (problems.length) return problems;
	return holdTsv(join(ws.root, guard.ratchet), facts, write, guard.forbid);
}
