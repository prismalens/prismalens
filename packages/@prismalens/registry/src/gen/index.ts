// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { appendLedger, ledgerProblems, parseLedger } from "../ledger.ts";
import type {
	Manifest,
	ManifestCase,
	ManifestClosed,
	ManifestEntry,
	ManifestUse,
} from "../manifest.ts";
import {
	EXPORT,
	type Forbid,
	type KindSource,
	readCaseTags,
	readClosed,
	readEntries,
	readForbidden,
	readGallery,
	readKinds,
	readObjects,
	readUses,
} from "./extract.ts";
import { familyIds } from "./ids.ts";
import { scanModules } from "./modules.ts";
import { workspaceOf } from "./workspace.ts";

export {
	type KindSource,
	literal,
	readEntries,
	readGallery,
	readKinds,
	readUses,
} from "./extract.ts";

/** `registry.config.json`, paths relative to the file itself (the app root). */
export interface Config {
	/** Absolute app root. */
	readonly root: string;
	readonly src: string;
	readonly kinds: string;
	readonly out: string;
	/** `source` (default) reads literals from source and collects through a Vite glob; `module` imports the files in Node. */
	readonly collect?: "source" | "module";
	readonly gallery?: string;
	/** The ratchet TSV, and the dirs whose text rules it counts. */
	readonly ratchet?: string;
	readonly ratchetDirs?: readonly string[];
	/** A Biome config dir for a second lint pass over files the main config excludes (test files). */
	readonly testLint?: string;
	/** Repo-relative path prefixes a PR changes only with the operator's `label`. */
	readonly protected?: readonly string[];
	readonly label?: string;
	/** Repo-relative JSON budgets that ratchet: a number may fall freely, only the label raises one. */
	readonly budgets?: readonly string[];
	/** Where the registry's L1 plugins live, and the gallery file `new` adds section stubs to. */
	readonly plugins?: string;
	readonly newGallery?: string;
	/** Where the closed sets live, and the repo root (relative) their `path` fields resolve against. */
	readonly closed?: string;
	readonly repo?: string;
	/** Dirs whose tests declare coverage tags. */
	readonly cases?: readonly string[];
	readonly climb?: boolean;
	/** The bar issue `render` writes and `judge-pack` checks. */
	readonly bar?: { readonly issue: number; readonly repo: string };
	/** Patterns no component may use outside an allowlist; counted into the ratchet. */
	readonly forbid?: readonly Forbid[];
	/** The workspace this host belongs to: the CLI then reads and checks every host in it. */
	readonly workspace?: string;
	/** The stored-id ledger (`ledger.ts`): its file, and the kind and field whose claims it holds. */
	readonly ledger?: {
		readonly file: string;
		readonly kind: string;
		readonly field: string;
	};
}

export function loadConfig(file: string): Config {
	const raw = JSON.parse(readFileSync(file, "utf8")) as Omit<Config, "root">;
	return { ...raw, root: dirname(resolve(file)) };
}

const SKIP = /(?:\.test|\.spec|\.gen)\.tsx?$|\.d\.ts$/;

/** Every source file under a directory, as root-relative POSIX paths. */
function sources(root: string, dir: string): string[] {
	const abs = join(root, dir);
	if (!existsSync(abs)) return [];
	return (readdirSync(abs, { recursive: true }) as string[])
		.map((f) => posix.join(dir, f.split("\\").join("/")))
		.filter(
			(f) =>
				/\.tsx?$/.test(f) && !SKIP.test(f) && !f.includes("/node_modules/"),
		)
		.sort();
}

const byId = <T extends { id: string; file: string }>(a: T, b: T) =>
	a.id < b.id
		? -1
		: a.id > b.id
			? 1
			: a.file < b.file
				? -1
				: a.file > b.file
					? 1
					: 0;

/** A ref's type: an open kind's generated id union, or a closed set's member ids. */
const refType = (m: Manifest, target: string): string => {
	if (m.kinds[target]) return typeName(target);
	const ids = Object.keys(m.closed?.[target]?.members ?? {});
	return ids.length ? ids.map((id) => JSON.stringify(id)).join(" | ") : "never";
};

const typeName = (kind: string) =>
	`${kind[0]?.toUpperCase()}${kind.slice(1)}Id`;

/** Reads the kinds and every file they collect, and builds the manifest. */
export function buildManifest(cfg: Config): {
	manifest: Manifest;
	kinds: KindSource[];
	problems: string[];
} {
	if (cfg.collect === "module") return buildModuleManifest(cfg);
	const problems: string[] = [];
	const read = (f: string) => readFileSync(join(cfg.root, f), "utf8");
	const kinds = sources(cfg.root, cfg.kinds)
		.flatMap((f) => readKinds(f, read(f), problems))
		.sort((a, b) => (a.name < b.name ? -1 : 1));
	const all = sources(cfg.root, cfg.src);
	const entries: Record<string, ManifestEntry[]> = Object.fromEntries(
		kinds.map((k) => [k.name, []]),
	);
	const uses: Record<string, ManifestUse[]> = Object.fromEntries(
		kinds.filter((k) => k.uses).map((k) => [k.name, []]),
	);
	const hints = kinds.flatMap((k) => [
		...(k.uses?.components ?? []).map((c) => `<${c}`),
		...(k.uses?.attribute ? [k.uses.attribute] : []),
		...(k.uses?.calls ?? []).map((c) => `${c}(`),
	]);
	const objects: { name: string; file: string; export: string }[] = [];
	const forbidden: {
		file: string;
		rule: string;
		count: number;
		fix: string;
	}[] = [];
	const fixOf = new Map((cfg.forbid ?? []).map((f) => [f.rule, f.fix]));
	const gallery = new Set<string>();
	const families = familyIds(workspaceOf(cfg), cfg.forbid ?? []);
	problems.push(...families.problems);
	const aliases = kinds.flatMap((k) => k.aliases.map((a) => `|${a}`)).join("");
	const calls = new RegExp(String.raw`\b(?:define\.\w+${aliases})\s*[<(]`);
	for (const f of all) {
		const text = read(f);
		if (kinds.some((k) => f.endsWith(k.suffix)) || calls.test(text))
			for (const { kind, entry } of readEntries(f, text, kinds, problems))
				entries[kind]?.push(entry);
		if (kinds.some((k) => f.endsWith(k.suffix)))
			objects.push(...readObjects(f, text, problems));
		for (const { rule, count } of readForbidden(
			f,
			text,
			cfg.forbid ?? [],
			families.ids,
		))
			forbidden.push({ file: f, rule, count, fix: fixOf.get(rule) ?? "" });
		if (cfg.gallery && f.startsWith(`${cfg.gallery}/`))
			for (const id of readGallery(f, text)) gallery.add(id);
		if (hints.some((h) => text.includes(h)))
			for (const { kind, use } of readUses(f, text, kinds))
				uses[kind]?.push(use);
	}
	// A use that names an entry by its exported binding resolves to that entry's id.
	for (const [kind, list] of Object.entries(uses)) {
		const byExport = new Map(
			(entries[kind] ?? []).map((e) => [e.export, e.id]),
		);
		uses[kind] = list.flatMap((u) => {
			if (!u.id.startsWith(EXPORT)) return [u];
			const id = byExport.get(u.id.slice(EXPORT.length));
			return id ? [{ id, file: u.file }] : [];
		});
	}
	const closed: Record<string, ManifestClosed> = {};
	for (const f of all.filter((f) => read(f).includes("defineClosed(")))
		for (const c of readClosed(f, read(f), problems)) {
			if (closed[c.name])
				problems.push(`${f}: closed set "${c.name}" is defined twice`);
			closed[c.name] = { file: f, members: withPaths(cfg, c.views) };
		}
	const manifest: Manifest = {
		version: 1,
		kinds: Object.fromEntries(
			kinds.map(({ name, uses: _uses, ...k }) => [
				name,
				{ ...k, refs: sortKeys(k.refs) },
			]),
		),
		entries: Object.fromEntries(
			Object.entries(entries).map(([k, v]) => [k, v.sort(byId)]),
		),
		gallery: Array.from(gallery).sort(),
		uses: Object.fromEntries(
			Object.entries(uses).map(([k, v]) => [k, dedupe(v.sort(byId))]),
		),
		...(Object.keys(closed).length ? { closed: sortKeys(closed) } : {}),
		...(cfg.cases ? { cases: readCases(cfg) } : {}),
		...(cfg.climb !== undefined ? { climb: cfg.climb } : {}),
		...(objects.length
			? { objects: objects.sort((a, b) => (a.name < b.name ? -1 : 1)) }
			: {}),
		...(cfg.forbid ? { forbidden } : {}),
	};
	return { manifest, kinds, problems };
}

/** A module host's manifest: its kinds and entries as Node imports them, guards already run. */
function buildModuleManifest(cfg: Config): {
	manifest: Manifest;
	kinds: KindSource[];
	problems: string[];
} {
	const kindFiles = sources(cfg.root, cfg.kinds);
	const entryFiles = sources(cfg.root, cfg.src).filter(
		(f) => !kindFiles.includes(f),
	);
	const scanned = scanModules(cfg.root, kindFiles, entryFiles);
	const fixOf = new Map((cfg.forbid ?? []).map((f) => [f.rule, f.fix]));
	const families = familyIds(workspaceOf(cfg), cfg.forbid ?? []);
	const forbidden = entryFiles.flatMap((f) =>
		readForbidden(
			f,
			readFileSync(join(cfg.root, f), "utf8"),
			cfg.forbid ?? [],
			families.ids,
		).map(({ rule, count }) => ({
			file: f,
			rule,
			count,
			fix: fixOf.get(rule) ?? "",
		})),
	);
	const manifest: Manifest = {
		version: 1,
		kinds: sortKeys(scanned.kinds),
		entries: sortKeys(scanned.entries),
		gallery: [],
		uses: {},
		...(cfg.forbid ? { forbidden } : {}),
	};
	return {
		manifest,
		kinds: [],
		problems: [...scanned.problems, ...families.problems],
	};
}

/** Marks each view that names a `path` with whether it exists under the repo root. */
function withPaths(
	cfg: Config,
	views: ManifestClosed["members"],
): ManifestClosed["members"] {
	return Object.fromEntries(
		Object.entries(views).map(([id, v]) => [
			id,
			typeof v.path === "string"
				? {
						...v,
						pathExists: existsSync(join(cfg.root, cfg.repo ?? ".", v.path)),
					}
				: v,
		]),
	);
}

const TEST = /\.(?:test|spec)\.tsx?$|\.feature$/;

/** Every test under the case dirs that carries at least one coverage tag. */
function readCases(cfg: Config): ManifestCase[] {
	return (cfg.cases ?? [])
		.flatMap((dir) => {
			const abs = join(cfg.root, dir);
			if (!existsSync(abs)) return [];
			return (readdirSync(abs, { recursive: true }) as string[])
				.map((f) => posix.join(dir, f.split("\\").join("/")))
				.filter((f) => TEST.test(f) && !f.includes("/node_modules/"));
		})
		.sort()
		.flatMap((file) => {
			const tags = readCaseTags(readFileSync(join(cfg.root, file), "utf8"));
			return tags.conditions.length || tags.walks.length || tags.surfaces.length
				? [{ file, ...tags }]
				: [];
		});
}

const sortKeys = <T>(o: Readonly<Record<string, T>>): Record<string, T> =>
	Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));

const dedupe = (uses: ManifestUse[]) =>
	uses.filter(
		(u, i) =>
			i === 0 || u.id !== uses[i - 1]?.id || u.file !== uses[i - 1]?.file,
	);

const HEADER = `// Generated by \`pnpm registry gen\` from the kinds in registry/kinds and the files they name.
// Do not edit: the gate regenerates it and fails on any difference.
`;

/** `registry.gen.ts`: one id union per kind, the ref types, and the eager glob the collector reads. */
export function emitTypes(cfg: Config, manifest: Manifest): string {
	const lines = [HEADER];
	const kinds = Object.keys(manifest.kinds);
	for (const k of kinds) {
		const ids = Array.from(
			new Set((manifest.entries[k] ?? []).map((e) => e.id)),
		);
		lines.push(`/** Every ${k} id. */`);
		lines.push(
			ids.length
				? `export type ${typeName(k)} =\n${ids.map((id) => `\t| ${JSON.stringify(id)}`).join("\n")};\n`
				: `export type ${typeName(k)} = never;\n`,
		);
	}
	lines.push("export interface RegistryIds {");
	for (const k of kinds) lines.push(`\t${k}: ${typeName(k)};`);
	lines.push("}\n");
	lines.push("export type KindName = keyof RegistryIds;\n");
	lines.push("/** Each kind's ref fields, typed by the kind they name. */");
	lines.push("export interface RegistryRefs {");
	for (const k of kinds) {
		const refs = Object.entries(manifest.kinds[k]?.refs ?? {});
		const body = refs.map(
			([p, t]) => ` ${JSON.stringify(p)}: ${refType(manifest, t)};`,
		);
		lines.push(
			`\t${k}: ${refs.length ? `{${body.join("")} }` : "Record<never, never>"};`,
		);
	}
	lines.push("}\n");
	for (const k of kinds) {
		const index = manifest.kinds[k]?.index;
		if (!index) continue;
		lines.push(`/** ${k} id → the object it acts on. */`);
		lines.push(`export interface ${index} {`);
		for (const e of manifest.entries[k] ?? []) {
			const object =
				typeof e.fields.object === "string"
					? e.fields.object
					: (e.id.split(".")[0] ?? e.id);
			lines.push(`\t${JSON.stringify(e.id)}: ${JSON.stringify(object)};`);
		}
		lines.push("}\n");
	}
	{
		const objects = manifest.objects ?? [];
		const ref = (o: { file: string; export: string }) => {
			const rel = posix.relative(cfg.out, o.file).replace(/\.tsx?$/, "");
			return `(typeof import(${JSON.stringify(rel.startsWith(".") ? rel : `./${rel}`)}))[${JSON.stringify(o.export)}]`;
		};
		if (objects.length)
			lines.push(
				'import type { CtxOf, StatesOf } from "@prismalens/registry";\n',
			);
		lines.push(
			"/** Object kind → the context its actions run with, from each defineObject. */",
		);
		lines.push("export interface ObjectContexts {");
		for (const o of objects)
			lines.push(`\t${JSON.stringify(o.name)}: CtxOf<${ref(o)}>;`);
		lines.push("}\n");
		lines.push("/** Object kind → the yes/no states its actions may test. */");
		lines.push("export interface ObjectStates {");
		for (const o of objects)
			lines.push(`\t${JSON.stringify(o.name)}: StatesOf<${ref(o)}>;`);
		lines.push("}\n");
	}
	if (cfg.collect === "module")
		return `${lines.join("\n")}${emitBarrel(cfg, manifest)}`;
	const rel = posix.relative(cfg.out, cfg.src) || ".";
	const glob = (ks: string[]) =>
		ks
			.map(
				(k) =>
					`\t\t${JSON.stringify(`${rel}/**/*${manifest.kinds[k]?.suffix}`)},`,
			)
			.join("\n");
	const live = kinds.filter((k) => manifest.kinds[k]?.runtime !== false);
	const checked = kinds.filter((k) => manifest.kinds[k]?.runtime === false);
	lines.push(
		"/** Each kind's name and suffix: all the collector needs, so the app never loads the kind files. */",
	);
	lines.push("export const KINDS = [");
	for (const k of kinds)
		lines.push(
			`\t{ name: ${JSON.stringify(k)}, suffix: ${JSON.stringify(manifest.kinds[k]?.suffix)} },`,
		);
	lines.push("] as const;\n");
	lines.push(
		"/** Every file a kind the app runs on collects, loaded once at startup. */",
	);
	lines.push(
		"export const entryModules = import.meta.glob<Record<string, unknown>>(",
	);
	lines.push(`\t[\n${glob(live)}\n\t],`);
	lines.push("\t{ eager: true },");
	lines.push(");\n");
	lines.push(
		"/** Files of kinds only the guards and the CLI read: loaded on demand, never at startup. */",
	);
	lines.push(
		"export const checkModules = import.meta.glob<Record<string, unknown>>(",
	);
	lines.push(checked.length ? `\t[\n${glob(checked)}\n\t],` : "\t[],");
	lines.push(");");
	return `${lines.join("\n")}\n`;
}

/** A module host's runtime barrel: one static import per entry file, so Node and bundlers load it without a glob. */
function emitBarrel(cfg: Config, manifest: Manifest): string {
	const files = Array.from(
		new Set(
			Object.values(manifest.entries)
				.flat()
				.map((e) => e.file),
		),
	).sort();
	const spec = (f: string) => {
		const rel = posix.relative(cfg.out, f);
		return rel.startsWith(".") ? rel : `./${rel}`;
	};
	const out = files.map(
		(f, i) => `import * as m${i} from ${JSON.stringify(spec(f))};`,
	);
	out.push(
		"",
		"/** Every entry file this host declares, by path: what `collect` reads at runtime. */",
		"export const builtIn = {",
		...files.map((f, i) => `\t${JSON.stringify(f)}: m${i},`),
		"} as const;",
	);
	return `${out.join("\n")}\n`;
}

export const emitManifest = (manifest: Manifest) =>
	`${JSON.stringify(manifest, null, "\t")}\n`;

export const OUT_TYPES = "registry.gen.ts";
export const OUT_MANIFEST = "registry.manifest.json";

/**
 * Generates both files. `check` compares instead of writing and returns the
 * stale ones; problems in source fail either way.
 */
/** Writes the two generated files, each only when it changed; they are not in git (#1101). `write: false` only reads. */
export function generate(
	cfg: Config,
	opts: { writeLedger?: boolean; write?: boolean } = {},
): {
	problems: string[];
	manifest: Manifest;
} {
	const { manifest, problems } = buildManifest(cfg);
	if (cfg.ledger) {
		const file = join(cfg.root, cfg.ledger.file);
		const entries = manifest.entries[cfg.ledger.kind] ?? [];
		let text = existsSync(file) ? readFileSync(file, "utf8") : "";
		if (opts.writeLedger && opts.write !== false) {
			const next = appendLedger(text, entries, cfg.ledger.field);
			if (next !== text) writeFileSync(file, next);
			text = next;
		}
		const parsed = parseLedger(text);
		problems.push(
			...[
				...parsed.problems,
				...ledgerProblems(parsed.rows, entries, cfg.ledger.field),
			].map(
				(p) =>
					`[${cfg.ledger?.kind}/stored-id] ${p}. Fix: a new claim gets its row from \`pnpm registry gen --write-ledger\`; a shipped value keeps its owner (rename through aliases).`,
			),
		);
	}
	const files = {
		[posix.join(cfg.out, OUT_TYPES)]: emitTypes(cfg, manifest),
		[posix.join(cfg.out, OUT_MANIFEST)]: emitManifest(manifest),
	};
	for (const [f, text] of Object.entries(opts.write === false ? {} : files)) {
		const abs = join(cfg.root, f);
		const now = existsSync(abs)
			? readFileSync(abs, "utf8").replace(/\r\n/g, "\n")
			: null;
		if (now !== text) writeFileSync(abs, text);
	}
	return { problems, manifest };
}
