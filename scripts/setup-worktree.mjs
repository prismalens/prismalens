#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Readies a checkout in one command: install, Prisma client, registry, and the build a built sim
// serves, from turbo's cache, which worktrees of one clone share (#1133). Safe to run again.
//   pnpm setup:worktree [--rebuild]
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { buildForSim, ROOT } from "./build-cache.mjs";

/**
 * Runs the steps in order, printing one timed line each; stops at the first failure with its
 * output and returns 1, else 0.
 * @param {[string, () => unknown][]} steps
 * @param {{ out?: (m: string) => void, err?: (m: string) => void, now?: () => number }} io
 */
export function runSteps(
	steps,
	{ out = console.log, err = console.error, now = Date.now } = {},
) {
	const secs = (/** @type {number} */ since) =>
		`${((now() - since) / 1000).toFixed(1)}s`;
	const all = now();
	for (const [name, run] of steps) {
		const t = now();
		try {
			run();
		} catch (e) {
			const x =
				/** @type {{ stdout?: string, stderr?: string, status?: number }} */ (
					e
				);
			if (x.stdout) err(x.stdout);
			err(x.stderr || String(e));
			err(
				`[setup] ${name} FAILED after ${secs(t)} (exit ${x.status ?? "?"}); its output is above. Fix it and run pnpm setup:worktree again.`,
			);
			return 1;
		}
		out(`[setup] ${name} ok ${secs(t)}`);
	}
	out(`[setup] ready in ${secs(all)}`);
	return 0;
}

/** Runs a shell line from the root, holding its output back unless it fails. */
const sh = (/** @type {string} */ line) => () =>
	execSync(line, {
		cwd: ROOT,
		windowsHide: true,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		maxBuffer: 256 * 1024 * 1024,
	});

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	// Under `pnpm setup:worktree`, npm_execpath is the pnpm that started us; pnpm on PATH otherwise.
	const pnpm = process.env.npm_execpath
		? `"${process.execPath}" "${process.env.npm_execpath}"`
		: "pnpm";
	process.exitCode = runSteps([
		["install", sh(`${pnpm} install --frozen-lockfile --prefer-offline`)],
		["prisma client", sh(`${pnpm} db:generate`)],
		["registry", sh(`${pnpm} registry gen`)],
		[
			"build",
			() =>
				buildForSim({
					force: process.argv.includes("--rebuild"),
					quiet: true,
					log: (m) => console.log(`[setup]   ${m}`),
				}),
		],
	]);
}
