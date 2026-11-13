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
	const start = text.indexOf("{");
	if (start < 0) throw new Error("biome lint wrote no JSON report");
	const toFile = (p: string) =>
		toPosix(relative(cfg.root, isAbsolute(p) ? p : join(cwd, p)));
	lintFacts(JSON.parse(text.slice(start)), toFile, facts);
	for (const f of files(cfg.root, cfg.ratchetDirs ?? [cfg.src]))
		countText(facts, f, readFileSync(join(cfg.root, f), "utf8"));
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
	if (write) {
		writeFileSync(file, formatTsv(actual));
		return [];
	}
	const { facts, problems } = parseTsv(
		existsSync(file) ? readFileSync(file, "utf8") : "",
	);
	return [...problems, ...compare(facts, actual)];
}
