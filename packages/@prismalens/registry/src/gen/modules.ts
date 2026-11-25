// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collect } from "../collect.ts";
import { formatProblems, runGuards } from "../guards.ts";
import type { AnyKind, Entry } from "../kind.ts";
import type {
	Literal,
	Manifest,
	ManifestEntry,
	ManifestKind,
} from "../manifest.ts";

/** What a module host's scan hands the generator: its kinds, entries and guard problems. */
export interface ModuleScan {
	readonly kinds: Readonly<Record<string, ManifestKind>>;
	readonly entries: Readonly<Record<string, readonly ManifestEntry[]>>;
	readonly problems: readonly string[];
}

const isKind = (v: unknown): v is AnyKind =>
	typeof v === "object" &&
	v !== null &&
	typeof (v as AnyKind).name === "string" &&
	typeof (v as AnyKind).suffix === "string" &&
	Array.isArray((v as AnyKind).guards) &&
	typeof (v as AnyKind).define === "function";

/** A live value as a manifest literal: plain data stays, functions and schemas drop out. */
export function toLiteral(v: unknown): Literal | undefined {
	if (v === null || ["string", "number", "boolean"].includes(typeof v))
		return v as Literal;
	if (Array.isArray(v))
		return v.map(toLiteral).filter((x): x is Literal => x !== undefined);
	if (typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
		const out: Record<string, Literal> = {};
		for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
			const lit = toLiteral(x);
			if (lit !== undefined) out[k] = lit;
		}
		return out;
	}
	return undefined;
}

const kindRecord = (k: AnyKind, file: string): ManifestKind => ({
	file,
	suffix: k.suffix,
	about: k.about,
	refs: k.refs,
	guards: k.guards.map((g) => g.name),
	aliases: k.aliases ?? [],
	keywords: k.keywords,
	...(k.index ? { index: k.index } : {}),
	...(k.runtime === false ? { runtime: false } : {}),
	scaffold: k.scaffold,
});

/**
 * Imports a module host's kind files and entry files and runs every guard over the live
 * entries. Runs in its own process (see `scanModules`), so the generator stays synchronous.
 */
export async function scan(
	root: string,
	kindFiles: readonly string[],
	entryFiles: readonly string[],
): Promise<ModuleScan> {
	const load = (f: string) =>
		import(pathToFileURL(join(root, f)).href) as Promise<
			Record<string, unknown>
		>;
	const kinds: { kind: AnyKind; file: string }[] = [];
	for (const f of kindFiles)
		for (const v of Object.values(await load(f)))
			if (isKind(v)) kinds.push({ kind: v, file: f });
	kinds.sort((a, b) => (a.kind.name < b.kind.name ? -1 : 1));
	const modules: Record<string, Record<string, unknown>> = {};
	const suffixes = kinds.map((k) => k.kind.suffix);
	for (const f of entryFiles)
		if (suffixes.some((s) => f.endsWith(s))) modules[f] = await load(f);
	const live = collect(
		kinds.map((k) => k.kind),
		modules,
	);
	const entries: Record<string, ManifestEntry[]> = {};
	for (const { kind } of kinds) entries[kind.name] = [];
	for (const [file, mod] of Object.entries(modules))
		for (const [name, v] of Object.entries(mod)) {
			const e = v as Entry;
			if (live.fileOf(e?.kind, e?.id) !== file) continue;
			const fields = toLiteral(v);
			entries[e.kind]?.push({
				id: e.id,
				file,
				export: name,
				fields: (fields ?? {}) as ManifestEntry["fields"],
			});
		}
	for (const list of Object.values(entries))
		list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const manifest: Manifest = {
		version: 1,
		kinds: Object.fromEntries(
			kinds.map(({ kind, file }) => [kind.name, kindRecord(kind, file)]),
		),
		entries,
		gallery: [],
		uses: {},
	};
	return {
		kinds: manifest.kinds,
		entries,
		problems: formatProblems(
			runGuards(
				kinds.map((k) => k.kind),
				manifest,
				live,
			),
		),
	};
}

const SELF = fileURLToPath(import.meta.url);

/** `scan` in a child process: imports must not run inside the CLI, which other code imports. */
export function scanModules(
	root: string,
	kindFiles: readonly string[],
	entryFiles: readonly string[],
): ModuleScan {
	const r = spawnSync(
		process.execPath,
		[SELF, JSON.stringify({ root, kindFiles, entryFiles })],
		{ encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
	);
	if (r.status !== 0)
		return {
			kinds: {},
			entries: {},
			problems: [
				`registry: importing the module host at ${root} failed: ${(r.stderr || r.error?.message || "").trim()}`,
			],
		};
	return JSON.parse(r.stdout) as ModuleScan;
}

if (
	process.argv[1] &&
	pathToFileURL(process.argv[1]).href === import.meta.url
) {
	const { root, kindFiles, entryFiles } = JSON.parse(process.argv[2] ?? "{}");
	process.stdout.write(JSON.stringify(await scan(root, kindFiles, entryFiles)));
}
