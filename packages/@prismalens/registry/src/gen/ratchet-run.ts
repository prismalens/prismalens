// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, posix, relative } from "node:path";
import {
	compare,
	countText,
	formatTsv,
	lintFacts,
	parseTsv,
} from "../ratchet.ts";
import type { Config } from "./index.ts";

/** Rows whose file starts with this are recorded by `scripts/measure`, never re-measured here. */
const EXTERNAL = "measure/";

const toPosix = (p: string) => p.split("\\").join("/");

/** Every .ts/.tsx under the ratchet's dirs, tests included: suppressions there count too. */
function files(root: string, dirs: readonly string[]): string[] {
	return dirs.flatMap((dir) => {
		const abs = join(root, dir);
		if (!existsSync(abs)) return [];
		return (readdirSync(abs, { recursive: true }) as string[])
			.map((f) => posix.join(dir, toPosix(f)))
			.filter(
				(f) =>
					/\.tsx?$/.test(f) &&
					!/\.gen\.ts$/.test(f) &&
					!f.includes("/node_modules/"),
			);
	});
}

/** Counts today's facts: Biome's lint rules over `src`, and the text rules over the ratchet's dirs. */
export function measure(cfg: Config): Map<string, number> {
	const facts = new Map<string, number>();
	const biome = createRequire(join(cfg.root, "package.json")).resolve(
		"@biomejs/biome/bin/biome",
	);
	const toFile = (p: string) =>
		toPosix(relative(cfg.root, isAbsolute(p) ? p : join(cfg.root, p)));
	// A second pass with its own Biome config lints the test files the main config excludes.
	const passes = [
		[],
		...(cfg.testLint ? [[`--config-path=${cfg.testLint}`]] : []),
	];
	for (const extra of passes) {
		const run = spawnSync(
			process.execPath,
			[
				biome,
				"lint",
				...(extra.length
					? [cfg.src, ...(cfg.ratchetDirs ?? []).filter((d) => d !== cfg.src)]
					: [cfg.src]),
				...extra,
				"--reporter=json",
				"--max-diagnostics=none",
			],
			{ cwd: cfg.root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
		);
		const start = run.stdout.indexOf('{"summary"');
		if (start < 0)
			throw new Error(
				`biome lint printed no report: ${run.stderr.slice(0, 500)}`,
			);
		lintFacts(JSON.parse(run.stdout.slice(start)), toFile, facts);
	}
	for (const f of files(cfg.root, cfg.ratchetDirs ?? [cfg.src]))
		countText(facts, f, readFileSync(join(cfg.root, f), "utf8"));
	return facts;
}

/** Checks today's facts against the TSV, or writes them with `write`. */
export function ratchet(cfg: Config, write: boolean): string[] {
	if (!cfg.ratchet) return ["registry.config.json names no ratchet file"];
	const file = join(cfg.root, cfg.ratchet);
	const actual = measure(cfg);
	const { facts, problems } = parseTsv(
		existsSync(file) ? readFileSync(file, "utf8") : "",
	);
	// `measure/...` rows come from scripts/measure (network, long suites), not from this pass: carry them.
	const external = [...facts].filter(([k]) => k.startsWith(EXTERNAL));
	if (write) {
		writeFileSync(file, formatTsv(new Map([...actual, ...external])));
		return [];
	}
	return [
		...problems,
		...compare(
			new Map([...facts].filter(([k]) => !k.startsWith(EXTERNAL))),
			actual,
		),
	];
}
