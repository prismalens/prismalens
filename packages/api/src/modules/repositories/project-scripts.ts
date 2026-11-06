// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The scripts a project's folder declares (#1024 decision 6), read only:
 * package.json scripts with the runner its lockfile names, Makefile targets and
 * justfile recipes. Nothing here runs anything.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectScript } from "@prismalens/contracts";

/** A manifest bigger than this is skipped rather than read. */
const MAX_BYTES = 256 * 1024;
/** Scripts listed per source; a generated Makefile can declare thousands. */
const MAX_PER_SOURCE = 100;

async function readSmall(path: string): Promise<string | null> {
	try {
		const s = await stat(path);
		if (!s.isFile() || s.size > MAX_BYTES) return null;
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

/** The package manager a lockfile names; npm when there is none. */
async function runnerOf(dir: string): Promise<"npm" | "pnpm" | "yarn" | "bun"> {
	if (await exists(join(dir, "pnpm-lock.yaml"))) return "pnpm";
	if (await exists(join(dir, "yarn.lock"))) return "yarn";
	if (
		(await exists(join(dir, "bun.lockb"))) ||
		(await exists(join(dir, "bun.lock")))
	)
		return "bun";
	return "npm";
}

const NAME = /^[\w:.@/-]{1,100}$/;

export function packageScripts(
	text: string,
	runner: "npm" | "pnpm" | "yarn" | "bun",
): ProjectScript[] {
	let pkg: unknown;
	try {
		pkg = JSON.parse(text);
	} catch {
		return [];
	}
	const scripts = (pkg as { scripts?: unknown })?.scripts;
	if (!scripts || typeof scripts !== "object") return [];
	return Object.entries(scripts as Record<string, unknown>)
		.filter(([name, cmd]) => NAME.test(name) && typeof cmd === "string")
		.slice(0, MAX_PER_SOURCE)
		.map(([name]) => ({ runner, name, command: `${runner} run ${name}` }));
}

/** Explicit targets only: no pattern rules, no `.PHONY`-style specials, no variables. */
export function makeTargets(text: string): ProjectScript[] {
	const out: ProjectScript[] = [];
	const seen = new Set<string>();
	for (const line of text.split(/\r?\n/)) {
		const m =
			/^([A-Za-z0-9][\w.-]*(?:\s+[A-Za-z0-9][\w.-]*)*)\s*:(?![=:])/.exec(line);
		if (!m?.[1]) continue;
		for (const name of m[1].split(/\s+/)) {
			if (seen.has(name)) continue;
			seen.add(name);
			out.push({ runner: "make", name, command: `make ${name}` });
		}
		if (out.length >= MAX_PER_SOURCE) break;
	}
	return out.slice(0, MAX_PER_SOURCE);
}

/** Recipe headers at column 0; settings, aliases and private `_` recipes are skipped. */
export function justRecipes(text: string): ProjectScript[] {
	const out: ProjectScript[] = [];
	for (const line of text.split(/\r?\n/)) {
		const m = /^@?([A-Za-z][\w-]*)(?:\s+[^:]*)?:(?!=)/.exec(line);
		const name = m?.[1];
		if (!name || ["set", "alias", "export", "import", "mod"].includes(name))
			continue;
		if (out.some((s) => s.name === name)) continue;
		out.push({ runner: "just", name, command: `just ${name}` });
		if (out.length >= MAX_PER_SOURCE) break;
	}
	return out;
}

export async function detectScripts(dir: string): Promise<ProjectScript[]> {
	const out: ProjectScript[] = [];
	const pkg = await readSmall(join(dir, "package.json"));
	if (pkg) out.push(...packageScripts(pkg, await runnerOf(dir)));
	const make =
		(await readSmall(join(dir, "Makefile"))) ??
		(await readSmall(join(dir, "makefile")));
	if (make) out.push(...makeTargets(make));
	const just =
		(await readSmall(join(dir, "justfile"))) ??
		(await readSmall(join(dir, "Justfile"))) ??
		(await readSmall(join(dir, ".justfile")));
	if (just) out.push(...justRecipes(just));
	return out;
}
