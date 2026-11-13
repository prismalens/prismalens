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
import { type Config, generate, loadConfig } from "./gen/index.ts";
import { labelCheck } from "./gen/label-run.ts";
import { ratchet } from "./gen/ratchet-run.ts";
import type { Manifest } from "./manifest.ts";

const USAGE = `usage: registry [--config <file>] <command>
  gen [--check]                 write, or check, registry.gen.ts and registry.manifest.json
  where "<thing>"               which kind it is, the file to create, an example and the guards
  ls [kind] [--surface <id>]    what exists
  new <kind> <object.name>      scaffold an entry, a test stub and a gallery stub, then regenerate
  new kind <name>               scaffold a kind, its place in the kinds list and its L1 plugin
  ratchet [--write] [--report <json> --report-cwd <dir>]
                                check, or write, the lint and suppression counts; --report
                                reads a Biome JSON report instead of running Biome again
  label-check --base <sha> [--head <sha>]   does the PR need the operator's label (PR_LABELS=a,b)`;

const fail = (lines: readonly string[]) => {
	for (const l of lines) console.error(l);
	return lines.length ? 1 : 0;
};

const opt = (args: string[], name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args.splice(i, 2)[1] : undefined;
};

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
		console.log(where(readManifest(cfg), rest.join(" ")));
		return 0;
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
				const top = spawnSync("git", ["rev-parse", "--show-toplevel"], {
					cwd: cfg.root,
					encoding: "utf8",
				}).stdout.trim();
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
					...plan.edits
						.filter((e) => /\.tsx?$/.test(e.file))
						.map((e) => e.file),
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
