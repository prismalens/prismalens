// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, posix, relative } from "node:path";
import type { Manifest } from "../manifest.ts";
import { g4Facts } from "../quality.ts";
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

/** Biome's JSON report over `src`: read from a run the gate already made, or a fresh run. */
function lintReport(
	cfg: Config,
	report?: Report,
): { text: string; cwd: string } {
	if (report)
		return {
			text: readFileSync(join(cfg.root, report.file), "utf8"),
			cwd: join(cfg.root, report.cwd),
		};
	const biome = createRequire(join(cfg.root, "package.json")).resolve(
		"@biomejs/biome/bin/biome",
	);
	const run = spawnSync(
		process.execPath,
		[biome, "lint", cfg.src, "--reporter=json", "--max-diagnostics=none"],
		{ cwd: cfg.root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
	);
	return { text: run.stdout, cwd: cfg.root };
}

/** A JSON report file and the directory Biome ran in, both relative to the app root. */
export interface Report {
	readonly file: string;
	readonly cwd: string;
}

/** Counts today's facts: Biome's lint rules over `src`, and the text rules over the ratchet's dirs. */
export function measure(cfg: Config, report?: Report): Map<string, number> {
	const facts = new Map<string, number>();
	const { text, cwd } = lintReport(cfg, report);
	const start = text.indexOf('{"summary"');
	if (start < 0) throw new Error("biome lint wrote no JSON report");
	const toFile = (p: string) =>
		toPosix(relative(cfg.root, isAbsolute(p) ? p : join(cwd, p)));
	lintFacts(JSON.parse(text.slice(start)), toFile, facts);
	// A second pass with its own Biome config lints the test files the main config excludes.
	if (cfg.testLint) {
		const biome = createRequire(join(cfg.root, "package.json")).resolve(
			"@biomejs/biome/bin/biome",
		);
		const run = spawnSync(
			process.execPath,
			[
				biome,
				"lint",
				cfg.src,
				...(cfg.ratchetDirs ?? []).filter((d) => d !== cfg.src),
				`--config-path=${cfg.testLint}`,
				"--reporter=json",
				"--max-diagnostics=none",
			],
			{ cwd: cfg.root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
		);
		const at = run.stdout.indexOf('{"summary"');
		if (at < 0) throw new Error("biome test-lint wrote no JSON report");
		lintFacts(
			JSON.parse(run.stdout.slice(at)),
			(f) => toPosix(relative(cfg.root, isAbsolute(f) ? f : join(cfg.root, f))),
			facts,
		);
	}
	for (const f of files(cfg.root, cfg.ratchetDirs ?? [cfg.src]))
		countText(facts, f, readFileSync(join(cfg.root, f), "utf8"));
	const manifest = join(cfg.root, cfg.out, "registry.manifest.json");
	if (existsSync(manifest)) {
		const m = JSON.parse(readFileSync(manifest, "utf8")) as Manifest;
		for (const [k, n] of g4Facts(m, new Date().toISOString().slice(0, 10)))
			facts.set(k, (facts.get(k) ?? 0) + n);
		for (const f of m.forbidden ?? []) {
			const k = `${f.file}\t${f.rule}`;
			facts.set(k, (facts.get(k) ?? 0) + f.count);
		}
	}
	return facts;
}

/** Checks today's facts against the TSV, or writes them with `write`. */
export function ratchet(
	cfg: Config,
	write: boolean,
	report?: Report,
): string[] {
	if (!cfg.ratchet) return ["registry.config.json names no ratchet file"];
	const file = join(cfg.root, cfg.ratchet);
	const actual = measure(cfg, report);
	const { facts, problems } = parseTsv(
		existsSync(file) ? readFileSync(file, "utf8") : "",
	);
	// `measure/...` rows come from scripts/measure (network, long suites): carry them, never re-measure.
	const external = [...facts].filter(([k]) => k.startsWith(EXTERNAL));
	if (write) {
		writeFileSync(file, formatTsv(new Map([...actual, ...external])));
		return [];
	}
	const own = new Map([...facts].filter(([k]) => !k.startsWith(EXTERNAL)));
	const fixes = new Map((cfg.forbid ?? []).map((f) => [f.rule, f.fix]));
	return [...problems, ...compare(own, actual, fixes)];
}
