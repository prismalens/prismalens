// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomUUID } from "node:crypto";
/**
 * The scripts a project's folder declares (#1024 decision 6), read only:
 * package.json scripts with the runner its lockfile names, Makefile targets and
 * justfile recipes. Nothing here runs anything.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	PROJECT_SCRIPT_COMMAND_MAX,
	PROJECT_SCRIPT_NAME_MAX,
	PROJECT_SCRIPTS_MAX,
	type ProjectScript,
	runnableCommand,
} from "@prismalens/contracts";

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

type Stored = { id: string; name: string; command: string };

function metaOf(metadata: string | null | undefined): Record<string, unknown> {
	try {
		const v: unknown = JSON.parse(metadata ?? "{}");
		return v && typeof v === "object" && !Array.isArray(v)
			? (v as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

const valid = (s: unknown): s is Stored => {
	const r = s as Partial<Stored> | null;
	return (
		typeof r?.id === "string" &&
		typeof r.name === "string" &&
		r.name.length > 0 &&
		r.name.length <= PROJECT_SCRIPT_NAME_MAX &&
		typeof r.command === "string" &&
		r.command.length <= PROJECT_SCRIPT_COMMAND_MAX &&
		runnableCommand(r.command)
	);
};

/** The scripts a project stores in `metadata.scripts` (#1176); a malformed entry is skipped. */
export function storedScripts(
	metadata: string | null | undefined,
): ProjectScript[] {
	const list = metaOf(metadata).scripts;
	return (Array.isArray(list) ? list : [])
		.filter(valid)
		.slice(0, PROJECT_SCRIPTS_MAX)
		.map((s) => ({
			runner: "custom",
			id: s.id,
			name: s.name,
			command: s.command,
		}));
}

export type ScriptEdit =
	| { op: "add"; name: string; command: string }
	| { op: "update"; scriptId: string; name: string; command: string }
	| { op: "remove"; scriptId: string };

/** The metadata with one edit to its scripts, every other key kept; null when the id is unknown or the list is full. */
export function writeScripts(
	metadata: string | null,
	edit: ScriptEdit,
): string | null {
	const meta = metaOf(metadata);
	const list: Stored[] = storedScripts(metadata).map((s) => ({
		id: s.id ?? "",
		name: s.name,
		command: s.command,
	}));
	if (edit.op === "add") {
		if (list.length >= PROJECT_SCRIPTS_MAX) return null;
		list.push({ id: randomUUID(), name: edit.name, command: edit.command });
	} else {
		const i = list.findIndex((s) => s.id === edit.scriptId);
		if (i < 0) return null;
		if (edit.op === "remove") list.splice(i, 1);
		else
			list[i] = { id: edit.scriptId, name: edit.name, command: edit.command };
	}
	return JSON.stringify({ ...meta, scripts: list });
}

/** A project's scripts: the ones it stores, then the ones its folder declares; a git URL has no folder here. */
export async function projectScripts(repo: {
	sourceKind: string;
	url: string;
	subPath: string | null;
	metadata?: string | null;
}): Promise<ProjectScript[]> {
	const stored = storedScripts(repo.metadata);
	if (repo.sourceKind !== "folder") return stored;
	const dir = repo.subPath ? join(repo.url, repo.subPath) : repo.url;
	return [...stored, ...(await detectScripts(dir))];
}
