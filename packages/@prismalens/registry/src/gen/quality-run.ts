// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Literal, Manifest } from "../manifest.ts";
import {
	brief,
	type Condition,
	judgePack,
	type KitInputs,
	kitSheet,
	renderBar,
	replaceBlocks,
	scoreCheck,
	simMissing,
	staleBlocks,
} from "../quality.ts";
import { checkStampFile, sha256 } from "../stamp.ts";
import { git } from "./git.ts";
import type { Config } from "./index.ts";

const today = () => new Date().toISOString().slice(0, 10);
const gh = (args: string[]) =>
	execFileSync("gh", args, {
		windowsHide: true,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});

/** The bar body: a local file when given, else the bar issue read with gh. */
function barBody(cfg: Config, bodyFile?: string): string {
	if (bodyFile) return readFileSync(bodyFile, "utf8");
	if (!cfg.bar)
		throw new Error(
			"registry.config.json names no bar issue; pass --body-file",
		);
	return gh([
		"issue",
		"view",
		String(cfg.bar.issue),
		"--repo",
		cfg.bar.repo,
		"--json",
		"body",
		"-q",
		".body",
	]);
}

const withMarkers = (blocks: Record<string, string>) =>
	Object.entries(blocks)
		.map(([n, t]) => `<!-- registry:${n} -->\n${t}\n<!-- /registry:${n} -->`)
		.join("\n\n");

/** `render bar [--apply]`: prints the #1101 tables, or with --apply writes them into the bar issue's marker blocks. */
export function renderRun(
	cfg: Config,
	m: Manifest,
	apply: boolean,
): { out: string; problems: string[] } {
	const blocks = renderBar(m, today());
	if (!apply) return { out: withMarkers(blocks), problems: [] };
	if (!cfg.bar)
		return { out: "", problems: ["registry.config.json names no bar issue"] };
	const { body, problems } = replaceBlocks(barBody(cfg), blocks);
	if (problems.length) return { out: "", problems };
	const dir = mkdtempSync(join(tmpdir(), "registry-bar-"));
	try {
		writeFileSync(join(dir, "body.md"), body);
		gh([
			"issue",
			"edit",
			String(cfg.bar.issue),
			"--repo",
			cfg.bar.repo,
			"--body-file",
			join(dir, "body.md"),
		]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	return {
		out: `rendered ${Object.keys(blocks).join(", ")} into #${cfg.bar.issue}`,
		problems: [],
	};
}

const IMAGE = /\.(png|jpe?g|webp)$/i;

/** The kit's inputs from disk: the reference folders, calibration, the since list and the evidence. */
export function readKit(opts: {
	references: string;
	calibration?: string;
	since?: string;
	evidence?: string;
}): KitInputs {
	const read = (f?: string) =>
		f && existsSync(f) ? { file: f, text: readFileSync(f, "utf8") } : null;
	const refs: Record<string, string[]> = {};
	if (existsSync(opts.references))
		for (const d of readdirSync(opts.references, { withFileTypes: true }))
			if (d.isDirectory())
				refs[d.name] = readdirSync(join(opts.references, d.name)).filter((f) =>
					IMAGE.test(f),
				);
	const ev = opts.evidence;
	return {
		referenceRoot: opts.references,
		references: refs,
		calibration: read(opts.calibration),
		since: read(opts.since),
		evidence: ev
			? {
					dir: ev,
					measures: existsSync(join(ev, "measures.md")),
					compare: existsSync(join(ev, "compare"))
						? readdirSync(join(ev, "compare")).filter((f) => IMAGE.test(f))
						: [],
				}
			: null,
	};
}

/**
 * `judge-pack <cp> --template <dir> --out <dir> --references <dir> --calibration <file> --since <file>
 * [--evidence <dir>]`: refuses on a stale bar or a missing input, then fills every template and
 * writes the organizer's kit.md beside them.
 */
export function judgePackRun(
	cfg: Config,
	m: Manifest,
	cp: string,
	opts: {
		template: string;
		out: string;
		bodyFile?: string;
		references: string;
		calibration?: string;
		since?: string;
		evidence?: string;
	},
): { written: string[]; problems: string[] } {
	const stale = staleBlocks(barBody(cfg, opts.bodyFile), renderBar(m, today()));
	if (stale.length)
		return {
			written: [],
			problems: [
				`the bar's ${stale.join(", ")} tables differ from the registry: run \`pnpm registry render bar --apply\` first`,
			],
		};
	const templates = readdirSync(opts.template)
		.filter((f) => f.endsWith(".md"))
		.sort()
		.map((name) => ({
			name,
			text: readFileSync(join(opts.template, name), "utf8"),
		}));
	if (!templates.length)
		return {
			written: [],
			problems: [`${opts.template} holds no .md templates`],
		};
	const inputs = readKit(opts);
	const { files, problems } = judgePack(m, cp, templates, inputs);
	if (problems.length) return { written: [], problems };
	const sheet = {
		name: "kit.md",
		text: kitSheet(m, cp, inputs, [
			`- Calibration anchors: ${opts.calibration}`,
			`- Evidence: ${opts.evidence ?? "none: judges shoot every screen themselves"}`,
			`- Templates: ${opts.template}`,
		]),
	};
	mkdirSync(opts.out, { recursive: true });
	const all = [...files, sheet];
	for (const f of all) writeFileSync(join(opts.out, f.name), f.text);
	return { written: all.map((f) => join(opts.out, f.name)), problems: [] };
}

const cellCheck =
	(stamps: string, sha: string, run: string) =>
	(cell: {
		walk: string;
		condition: Condition;
		simulator: Readonly<Record<string, Literal>>;
	}) =>
		checkStampFile(stamps, {
			condition: cell.condition.id,
			walk: cell.walk,
			simulator: cell.condition.simulator,
			profile: cell.condition.profile,
			stamps: Array.isArray(cell.simulator.stamps)
				? cell.simulator.stamps.filter(
						(s): s is string => typeof s === "string",
					)
				: [],
			sha,
			run,
		});

/**
 * `score-check <scores.json> <stamps/> [--sha] [--run] [--sim]`: nulls each category
 * resting on an unstamped cell; with --sim, a sim run that left any active
 * condition unstamped fails.
 */
export function scoreCheckRun(
	m: Manifest,
	scoresFile: string,
	stamps: string,
	opts: { sha?: string; run?: string; sim?: boolean },
): {
	scores: Record<string, number | null>;
	why: Record<string, string[]>;
	problems: string[];
} {
	// A scores file is either the category map itself or { scores: map }.
	const raw = JSON.parse(readFileSync(scoresFile, "utf8")) as {
		scores?: Record<string, number | null>;
	} & Record<string, unknown>;
	const scores = (raw.scores ?? raw) as Record<string, number | null>;
	const sha = opts.sha ?? git(["rev-parse", "HEAD"]).trim();
	const check = cellCheck(stamps, sha, opts.run ?? basename(stamps));
	const result = scoreCheck(m, scores, check);
	return { ...result, problems: opts.sim ? simMissing(m, check) : [] };
}

/** `brief <surface…>`: the block a lane brief carries, with a hash the lane echoes back. */
export function briefRun(m: Manifest, surfaces: readonly string[]): string {
	const text = brief(m, surfaces, today());
	return `${text}\nbrief-hash: ${sha256(text).slice(0, 12)}`;
}
