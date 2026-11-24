#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Which lines a PR adds that no test runs, shown to the reviewer; information, never a gate
// (docs/contributing/testing.md). Reads each package's coverage/lcov.info, whose paths
// are relative to that package.
//
//   node scripts/changed-line-coverage.mjs <base-ref>

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** GitHub shows at most 10 notices per step; the summary carries the rest. */
const NOTICES = 10;

/** Lines each file gains in a `git diff --unified=0`, by repo-relative path. */
export function addedLines(diff) {
	const added = new Map();
	let file = null;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ ")) {
			file = line === "+++ /dev/null" ? null : line.slice(6);
			continue;
		}
		const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (!hunk || !file) continue;
		const start = Number(hunk[1]);
		const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
		const lines = added.get(file) ?? [];
		for (let n = start; n < start + count; n++) lines.push(n);
		added.set(file, lines);
	}
	return added;
}

/** Hit counts per executable line, by repo-relative path, from one package's lcov. */
export function lineHits(lcov, packageDir) {
	const hits = new Map();
	let current = null;
	for (const line of lcov.split(/\r?\n/)) {
		if (line.startsWith("SF:")) {
			const source = line.slice(3).replaceAll("\\", "/");
			current = new Map();
			hits.set(posix.join(packageDir, source), current);
		} else if (line.startsWith("DA:") && current) {
			const [n, count] = line.slice(3).split(",");
			current.set(Number(n), Number(count));
		}
	}
	return hits;
}

/** Per measured file: its added executable lines, and those no test ran. */
export function changedLineCoverage(added, hits) {
	const rows = [];
	for (const [file, lines] of added) {
		const fileHits = hits.get(file);
		if (!fileHits) continue;
		const measured = lines.filter((n) => fileHits.has(n));
		if (!measured.length) continue;
		const uncovered = measured.filter((n) => fileHits.get(n) === 0);
		rows.push({ file, measured: measured.length, uncovered });
	}
	return rows.sort((a, b) => b.uncovered.length - a.uncovered.length);
}

/** `[3, 4, 5, 9]` → `[[3, 5], [9, 9]]`. */
export function ranges(lines) {
	const out = [];
	for (const n of lines) {
		const last = out.at(-1);
		if (last && n === last[1] + 1) last[1] = n;
		else out.push([n, n]);
	}
	return out;
}

const span = ([a, b]) => (a === b ? `${a}` : `${a}-${b}`);

export function summary(rows) {
	const measured = rows.reduce((s, r) => s + r.measured, 0);
	const uncovered = rows.reduce((s, r) => s + r.uncovered.length, 0);
	if (!measured)
		return "### Changed-line coverage\n\nNo added line is in a package that measures coverage.\n";
	const lines = [
		"### Changed-line coverage",
		"",
		`${measured - uncovered} of ${measured} added executable lines run under a test. Information for the reviewer, not a gate.`,
		"",
	];
	const thin = rows.filter((r) => r.uncovered.length);
	if (thin.length) {
		lines.push("| File | Not run by any test |", "| --- | --- |");
		for (const r of thin)
			lines.push(
				`| \`${r.file}\` | ${ranges(r.uncovered).map(span).join(", ")} |`,
			);
	}
	return `${lines.join("\n")}\n`;
}

/** Inline notices on the PR's diff, the largest gaps first. */
export function notices(rows, max = NOTICES) {
	return rows
		.flatMap((r) =>
			ranges(r.uncovered).map(([a, b]) => ({ file: r.file, a, b })),
		)
		.sort((x, y) => y.b - y.a - (x.b - x.a))
		.slice(0, max)
		.map(
			({ file, a, b }) =>
				`::notice file=${file},line=${a},endLine=${b},title=Not run by any test::${a === b ? "Line" : "Lines"} ${span([a, b])} run under no test.`,
		);
}

function lcovFiles() {
	const found = [];
	for (const parent of ["packages", "packages/@prismalens"]) {
		for (const name of readdirSync(join(ROOT, parent))) {
			const dir = `${parent}/${name}`;
			if (existsSync(join(ROOT, dir, "coverage/lcov.info"))) found.push(dir);
		}
	}
	return found;
}

function main() {
	const base = process.argv[2];
	if (!base) {
		console.error("usage: changed-line-coverage.mjs <base-ref>");
		process.exit(2);
	}
	const diff = execFileSync(
		"git",
		["diff", "--unified=0", "--no-color", "--no-renames", base, "HEAD"],
		{ cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
	);
	const hits = new Map();
	for (const dir of lcovFiles())
		for (const [file, lines] of lineHits(
			readFileSync(join(ROOT, dir, "coverage/lcov.info"), "utf8"),
			dir,
		))
			hits.set(file, lines);
	const rows = changedLineCoverage(addedLines(diff), hits);
	const text = summary(rows);
	if (process.env.GITHUB_STEP_SUMMARY)
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
	console.log(text);
	for (const notice of notices(rows)) console.log(notice);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
