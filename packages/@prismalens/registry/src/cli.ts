#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, posix, relative } from "node:path";
import {
	apply,
	ls,
	planEntry,
	planKind,
	reader,
	where,
} from "./gen/commands.ts";
import { git } from "./gen/git.ts";
import { type Config, generate, loadConfig } from "./gen/index.ts";
import { labelCheck } from "./gen/label-run.ts";
import {
	briefRun,
	judgePackRun,
	renderRun,
	scoreCheckRun,
} from "./gen/quality-run.ts";
import { ratchet } from "./gen/ratchet-run.ts";
import type { Manifest } from "./manifest.ts";
import { profileConditions } from "./quality.ts";

const USAGE = `usage: registry [--config <file>] <command>
  gen [--check]                 write, or check, registry.gen.ts and registry.manifest.json
  where "<thing>"               which kind it is, the file to create, an example and the guards
  ls [kind] [--surface <id>]    what exists
  new <kind> <object.name> [--said "<quote>" --date <utc> --where <source>]
                                scaffold an entry, a test stub and a gallery stub, then regenerate
  new kind <name>               scaffold a kind, its place in the kinds list and its L1 plugin
  ratchet [--write] [--report <json> --report-cwd <dir>]
                                check, or write, the lint and suppression counts; --report
                                reads a Biome JSON report instead of running Biome again
  label-check --base <sha> [--head <sha>]   does the PR need the operator's label (PR_LABELS=a,b)
  render bar [--apply]          print #1101's category, walk and condition tables; --apply writes
                                them into the bar issue's <!-- registry:... --> blocks
  judge-pack <cp> --template <dir> --out <dir> [--body-file <bar.md>]
                                fill each judge template's {{conditions}} slot; refuses on a stale bar
  score-check <scores.json> <stamps/> [--sha <sha>] [--run <id>] [--sim]
                                null each category resting on an unstamped cell; --sim fails a
                                sim run that left an active condition unstamped
  brief <surface…>              the conditions and lenses in force on those surfaces, with a hash
  profile <name> [--json]       the conditions a sim profile applies: bare, ci, all, or one condition id`;

const fail = (lines: readonly string[]) => {
	for (const l of lines) console.error(l);
	return lines.length ? 1 : 0;
};

const opt = (args: string[], name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args.splice(i, 2)[1] : undefined;
};

/** `--said "<quote>" --date <utc> --where <session>`: who asked for a condition or lens, for its said field. */
function intake(args: string[]): Record<string, string> {
	const esc = (v: string) => JSON.stringify(v).slice(1, -1);
	return {
		said: esc(opt(args, "--said") ?? ""),
		date: opt(args, "--date") ?? new Date().toISOString().slice(0, 10),
		where: esc(opt(args, "--where") ?? ""),
	};
}

const readManifest = (cfg: Config): Manifest =>
	JSON.parse(
		readFileSync(join(cfg.root, cfg.out, "registry.manifest.json"), "utf8"),
	) as Manifest;

/** Formats what `new` wrote, the way the pre-commit hook would. */
function format(cfg: Config, files: readonly string[]) {
	const biome = createRequire(join(cfg.root, "package.json")).resolve(
		"@biomejs/biome/bin/biome",
	);
	spawnSync(process.execPath, [biome, "check", "--write", ...files], {
		cwd: cfg.root,
		stdio: "ignore",
	});
}

/** Adds a plugin entry to the repo's biome.json, keeping its \u escapes. */
function addPlugin(top: string, path: string, includes: string[]) {
	const file = join(top, "biome.json");
	const json = JSON.parse(readFileSync(file, "utf8")) as {
		plugins: { path: string; includes?: string[] }[];
	};
	json.plugins.push({ path: `./${path}`, includes });
	const BS = String.fromCharCode(92);
	writeFileSync(
		file,
		`${JSON.stringify(json, null, "\t")}\n`.replace(
			/[\u0080-￿]/g,
			(c) => `${BS}u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
		),
	);
}

function main(argv: string[]): number {
	const args = [...argv];
	const cfg = loadConfig(opt(args, "--config") ?? "registry.config.json");
	const [cmd, ...rest] = args;
	if (cmd === "gen") {
		const check = rest.includes("--check");
		const { problems, stale } = generate(cfg, check);
		const code = fail([
			...problems,
			...stale.map(
				(f) => `${f} is stale. Run \`pnpm registry gen\` and commit it.`,
			),
		]);
		if (!code) console.log(check ? "registry: fresh" : "registry: generated");
		return code;
	}
	if (cmd === "where") {
		if (!rest.length) return fail([USAGE]);
		const m = readManifest(cfg);
		const asked = rest.join(" ");
		const surface = (m.entries.surface ?? []).some((e) => e.id === asked);
		console.log(surface ? briefRun(m, [asked]) : where(m, asked));
		return 0;
	}
	if (cmd === "profile") {
		const json = rest.includes("--json");
		const name = rest.find((x) => x !== "--json");
		if (!name) return fail([USAGE]);
		const r = profileConditions(readManifest(cfg), name);
		if (!r.problems.length)
			console.log(
				json
					? JSON.stringify(r.conditions, null, 2)
					: r.conditions.map((c) => c.id).join("\n"),
			);
		return fail(r.problems);
	}
	if (cmd === "brief") {
		if (!rest.length) return fail([USAGE]);
		console.log(briefRun(readManifest(cfg), rest));
		return 0;
	}
	if (cmd === "render") {
		if (rest[0] !== "bar") return fail([USAGE]);
		const { out, problems } = renderRun(
			cfg,
			readManifest(cfg),
			rest.includes("--apply"),
		);
		if (out) console.log(out);
		return fail(problems);
	}
	if (cmd === "judge-pack") {
		const template = opt(rest, "--template");
		const out = opt(rest, "--out");
		const bodyFile = opt(rest, "--body-file");
		const cp = rest[0];
		if (!cp || !template || !out) return fail([USAGE]);
		const r = judgePackRun(cfg, readManifest(cfg), cp, {
			template,
			out,
			bodyFile,
		});
		for (const f of r.written) console.log(`wrote ${f}`);
		return fail(r.problems);
	}
	if (cmd === "score-check") {
		const sha = opt(rest, "--sha");
		const run = opt(rest, "--run");
		const sim = rest.includes("--sim");
		const [scores, stamps] = rest.filter((a) => a !== "--sim");
		if (!scores || !stamps) return fail([USAGE]);
		const r = scoreCheckRun(readManifest(cfg), scores, stamps, {
			sha,
			run,
			sim,
		});
		console.log(JSON.stringify(r.scores, null, 2));
		for (const [cat, why] of Object.entries(r.why))
			console.error(`category ${cat} is not tested: ${why.join("; ")}`);
		return fail(r.problems);
	}
	if (cmd === "ls") {
		const surface = opt(rest, "--surface");
		console.log(ls(readManifest(cfg), rest[0], surface));
		return 0;
	}
	if (cmd === "new") {
		const [kind, id] = rest;
		if (!kind || !id) return fail([USAGE]);
		const read = reader(cfg.root);
		try {
			if (kind === "kind") {
				const top = git(["rev-parse", "--show-toplevel"], {
					cwd: cfg.root,
				}).trim();
				const prefix = relative(top, cfg.root).split("\\").join("/");
				const plan = planKind(
					id,
					{
						kinds: cfg.kinds,
						plugins: cfg.plugins ?? "biome-plugins/registry",
						src: posix.join(prefix, cfg.src),
					},
					read,
				);
				apply(cfg.root, plan.edits);
				addPlugin(
					top,
					posix.join(prefix, plan.plugin.path),
					plan.plugin.includes,
				);
				format(cfg, [
					relative(cfg.root, join(top, "biome.json")),
					...plan.edits.map((e) => e.file),
				]);
				generate(cfg, false);
				console.log(
					[
						...plan.edits.map((e) => `wrote ${e.file}`),
						"added its L1 plugin to biome.json",
						...plan.next,
					].join("\n"),
				);
				return 0;
			}
			const plan = planEntry(readManifest(cfg), kind, id, read, {
				dir: opt(rest, "--dir"),
				gallery: cfg.newGallery,
				extra: intake(rest),
			});
			apply(cfg.root, plan.edits);
			format(
				cfg,
				plan.edits.map((e) => e.file),
			);
			const { problems } = generate(cfg, false);
			console.log(
				[
					...plan.edits.map(
						(e) => `${e.created ? "wrote" : "updated"} ${e.file}`,
					),
					...plan.next,
				].join("\n"),
			);
			return fail(problems);
		} catch (e) {
			return fail([(e as Error).message]);
		}
	}
	if (cmd === "ratchet") {
		const write = rest.includes("--write");
		const file = opt(rest, "--report");
		const report = file
			? { file, cwd: opt(rest, "--report-cwd") ?? "." }
			: undefined;
		const code = fail(ratchet(cfg, write, report));
		if (!code) console.log(write ? "ratchet: written" : "ratchet: holds");
		return code;
	}
	if (cmd === "label-check") {
		const code = fail(
			labelCheck(
				cfg,
				opt(rest, "--base") ?? "",
				opt(rest, "--head") ?? "HEAD",
				process.env.PR_LABELS ?? "",
			),
		);
		if (!code) console.log("label check: passes");
		return code;
	}
	return fail([USAGE]);
}

process.exitCode = main(process.argv.slice(2));
