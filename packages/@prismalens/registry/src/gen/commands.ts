// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import ts from "typescript";
import { GENERIC_GUARDS } from "../guards.ts";
import type { Scaffold } from "../kind.ts";
import { fieldAt, type Manifest, stringsIn } from "../manifest.ts";
import { parse } from "./extract.ts";

/** The placeholders an id fills in a scaffold. */
export function namesOf(id: string) {
	const parts = id.split(/[.-]/).filter(Boolean);
	const object = id.split(".")[0] ?? id;
	const camel = parts
		.map((p, i) => (i === 0 ? p : `${p[0]?.toUpperCase()}${p.slice(1)}`))
		.join("");
	const last = parts.at(-1) ?? id;
	const words = last.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
	return {
		id,
		object,
		name: camel,
		Object: `${object[0]?.toUpperCase()}${object.slice(1)}`,
		label: `${words[0]?.toUpperCase()}${words.slice(1)}`,
		lower: words,
		slug: id
			.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
			.replace(/\./g, "-")
			.toLowerCase(),
	};
}

export const fill = (template: string, names: Record<string, string>) =>
	template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => names[k] ?? m);

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];

/** The kinds that fit a request, best first: by name, keywords, then the kind's about line. */
export function rank(
	manifest: Manifest,
	request: string,
): { kind: string; score: number }[] {
	const asked = words(request);
	return Object.entries(manifest.kinds)
		.map(([kind, k]) => {
			const keys = k.keywords.flatMap(words);
			const about = new Set(words(k.about));
			let score = 0;
			for (const w of asked) {
				if (w === kind || w === `${kind}s`) score += 5;
				if (
					keys.some(
						(x) =>
							x === w || (w.length > 3 && (x.startsWith(w) || w.startsWith(x))),
					)
				)
					score += 3;
				if (about.has(w)) score += 1;
			}
			return { kind, score };
		})
		.filter((r) => r.score > 0)
		.sort((a, b) => b.score - a.score || (a.kind < b.kind ? -1 : 1));
}

/** `pnpm registry where "<thing>"`: the kind, the file to create, an example, the command and the guards. */
export function where(manifest: Manifest, request: string): string {
	const ranked = rank(manifest, request);
	const best = ranked[0];
	if (!best)
		return [
			`No kind fits "${request}". Kinds: ${Object.keys(manifest.kinds).join(", ")}.`,
			"If it is a new kind of thing a user can see, run, set or bind: pnpm new kind <name>.",
			"Never hand-write a list of { id, label } objects.",
		].join("\n");
	const k = manifest.kinds[best.kind];
	if (!k) return "";
	const example = manifest.entries[best.kind]?.[0];
	const out = [
		`${best.kind}: ${k.about}`,
		`  file:     ${k.scaffold ? `${k.scaffold.dir.replace(/{{object}}/g, "<object>")}/<object>${k.suffix}` : `*${k.suffix}`}, one exported define.${best.kind}({ id: "<object>.<name>", ... }) per entry`,
		`  example:  ${example ? `${example.file} (${example.id})` : "none yet"}`,
		`  scaffold: pnpm new ${best.kind} <object>.<name>${k.scaffold?.entry.includes("{{said}}") ? ' --said "<their words>" --date <utc> --where <source>' : ""}`,
		`  guards:   ${[...GENERIC_GUARDS.map((g) => g.name), ...k.guards].join(", ")}`,
	];
	const others = ranked.slice(1, 3).map((r) => r.kind);
	if (others.length) out.push(`  also:     ${others.join(", ")}`);
	return out.join("\n");
}

/** `pnpm registry ls [kind] [--surface id]`. */
export function ls(
	manifest: Manifest,
	kind?: string,
	surface?: string,
): string {
	if (!kind)
		return Object.entries(manifest.entries)
			.map(
				([k, list]) =>
					`${k}\t${list.length}\t${manifest.kinds[k]?.suffix ?? ""}`,
			)
			.join("\n");
	const list = manifest.entries[kind];
	if (!list)
		return `No kind "${kind}". Kinds: ${Object.keys(manifest.kinds).join(", ")}.`;
	let ids: Set<string> | null = null;
	if (surface) {
		const s = manifest.entries.surface?.find((e) => e.id === surface);
		const placed = s
			? [
					...stringsIn(fieldAt(s.fields, "menus.context")),
					...stringsIn(fieldAt(s.fields, "menus.more")),
				]
			: [];
		ids = new Set(
			kind === "action"
				? placed
				: list
						.filter((e) =>
							stringsIn(fieldAt(e.fields, "surfaces")).includes(surface),
						)
						.map((e) => e.id),
		);
	}
	return list
		.filter((e) => !ids || ids.has(e.id))
		.map(
			(e) =>
				`${e.id}\t${typeof e.fields.label === "string" ? e.fields.label : ""}\t${e.file}`,
		)
		.join("\n");
}

/** A file edit `new` makes; `text` is the whole new content. */
export interface Edit {
	readonly file: string;
	readonly text: string;
	readonly created: boolean;
}

function ensureImports(text: string, imports: readonly string[]): string {
	const missing = imports.filter((line) => !text.includes(line));
	if (!missing.length) return text;
	const sf = parse("x.ts", text);
	const last = sf.statements.filter(ts.isImportDeclaration).at(-1);
	const block = missing.join("\n");
	if (last)
		return `${text.slice(0, last.getEnd())}\n${block}${text.slice(last.getEnd())}`;
	const header = text.match(/^(?:\/\/.*\n)*\n?/)?.[0].length ?? 0;
	return `${text.slice(0, header)}${block}\n${text.slice(header)}`;
}

const HEADER =
	"// SPDX-License-Identifier: Apache-2.0\n// Copyright 2026 Sumit Patel\n\n";

/**
 * `pnpm new <kind> <id>`: the entry, appended to the object's file of that kind
 * or a new one, plus a gallery-section stub and a test stub when missing.
 */
export function planEntry(
	manifest: Manifest,
	kind: string,
	id: string,
	read: (file: string) => string | null,
	opts: { dir?: string; gallery?: string; extra?: Record<string, string> } = {},
): { edits: Edit[]; next: string[] } {
	const k = manifest.kinds[kind];
	if (!k?.scaffold)
		throw new Error(
			`No kind "${kind}" with a scaffold. Kinds: ${Object.keys(manifest.kinds).join(", ")}.`,
		);
	if (!/^[a-z][a-zA-Z0-9]*(?:[.-][a-zA-Z0-9]+)+$/.test(id))
		throw new Error(
			`"${id}" is not an id: write <object>.<name>, e.g. thread.archive.`,
		);
	if (manifest.entries[kind]?.some((e) => e.id === id))
		throw new Error(`${kind} "${id}" already exists.`);
	const names = { ...namesOf(id), ...opts.extra };
	const sameObject = (e: { id: string }) => e.id.split(".")[0] === names.object;
	const own = manifest.entries[kind]?.find(sameObject)?.file;
	const sibling = Object.values(manifest.entries).flat().find(sameObject)?.file;
	const dir =
		opts.dir ??
		(sibling ? posix.dirname(sibling) : fill(k.scaffold.dir, names));
	const file = own ?? posix.join(dir, `${names.object}${k.suffix}`);
	const before = read(file);
	let text = before ?? HEADER;
	text = ensureImports(text, k.scaffold.imports);
	const declared = (manifest.objects ?? []).some(
		(o) => o.name === names.object,
	);
	if (k.scaffold.object && !declared) {
		text = ensureImports(text, k.scaffold.object.imports);
		text = `${text.replace(/\n*$/, "\n")}\n${fill(k.scaffold.object.entry, names).replace(/\n*$/, "\n")}`;
	}
	text = `${text.replace(/\n*$/, "\n")}\n${fill(k.scaffold.entry, names).replace(/\n*$/, "\n")}`;
	const edits: Edit[] = [{ file, text, created: before === null }];
	const test = file.replace(/\.ts$/, ".test.ts");
	if (k.scaffold.test !== false && read(test) === null)
		edits.push({
			file: test,
			created: true,
			text: `${HEADER}import { describe, it } from "vitest";\n\ndescribe("${posix.basename(file)}", () => {\n\tit.todo("${id}: assert what it does at its public seam");\n});\n`,
		});
	const next = [`Fill in ${file}.`];
	if (k.guards.includes("galleryStates") && opts.gallery) {
		const g = read(opts.gallery);
		if (g?.includes("];")) {
			const section = `\t{\n\t\tid: "${names.slug}",\n\t\ttitle: "${id}",\n\t\trender: () => <div data-kit-state="${names.slug}">${id}: draw its default and phone states</div>,\n\t},\n`;
			const end = g.lastIndexOf("];");
			edits.push({
				file: opts.gallery,
				created: false,
				text: `${g.slice(0, end)}${section}${g.slice(end)}`,
			});
			next.push(
				`Draw it in ${opts.gallery} (section "${names.slug}"), or point its states at an existing gallery id.`,
			);
		}
	}
	if (kind === "action")
		next.push(
			`Place "${id}" in a surface's menus, or the reachable guard fails.`,
		);
	next.push(
		"Write the test in the stub, then run pnpm --filter @prismalens/frontend ui:check:static.",
	);
	return { edits, next };
}

/** `pnpm new kind <name>`: the kind file, its place in the kinds list, and its L1 lint plugin. */
export function planKind(
	name: string,
	paths: { kinds: string; plugins: string; src: string },
	read: (file: string) => string | null,
): {
	edits: Edit[];
	plugin: { path: string; includes: string[] };
	next: string[];
} {
	if (!/^[a-z][a-zA-Z]*$/.test(name))
		throw new Error(
			`"${name}" is not a kind name: one camelCase word, e.g. chip.`,
		);
	const kindFile = posix.join(paths.kinds, `${name}.ts`);
	if (read(kindFile) !== null) throw new Error(`${kindFile} exists.`);
	const Name = `${name[0]?.toUpperCase()}${name.slice(1)}`;
	const suffix = `.${/(?:s|x|ch|sh)$/.test(name) ? `${name}es` : `${name}s`}.ts`;
	const kindText = `${HEADER}import { defineKind, entry } from "@prismalens/registry";
import { labelled } from "../guards";
import { dottedId, text, z } from "./schema";

/** One ${name}: replace these fields with what the app reads. */
export interface ${Name}Spec {
	id: string;
	label: string;
}

export type ${Name}Def = ${Name}Spec & { readonly kind: "${name}" };

export function define${Name}(spec: ${Name}Spec): ${Name}Def {
	return entry("${name}", spec);
}

export const ${name} = defineKind({
	name: "${name}",
	suffix: "${suffix}",
	about: "TODO: one line on what a ${name} is and what reads it.",
	keywords: ["${name}"],
	schema: z.object({ kind: z.literal("${name}"), id: dottedId, label: text }),
	refs: {},
	guards: [labelled],
	define: define${Name},
	scaffold: {
		dir: "src/components/{{object}}",
		imports: ['import { define } from "@/registry/define";'],
		entry: 'export const {{name}} = define.${name}({\\n\\tid: "{{id}}",\\n\\tlabel: "{{label}}",\\n});',
	},
});
`;
	const indexFile = posix.join(paths.kinds, "index.ts");
	const index = read(indexFile) ?? "";
	const withImport = ensureImports(index, [
		`import { ${name} } from "./${name}";`,
	]);
	const withKind = withImport.replace(
		/export const kinds = \[([^\]]*)\] as const;/,
		(_m, list: string) => {
			const names = [
				...list
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean),
				name,
			].sort();
			return `export const kinds = [${names.join(", ")}] as const;`;
		},
	);
	const grit = posix.join(paths.plugins, `l1-${name}.grit`);
	const gritText = `// L1: a ${name} is defined only in its kind's *${suffix} files, so the collector and the
// generator see every one. biome.json scopes this plugin to everything else.
language js

\`define.${name}($def)\` as $call where {
	register_diagnostic(
		span=$call,
		message="[L1] A ${name} is defined only in a *${suffix} file. Fix: move this call into the object's *${suffix} (\`pnpm new ${name} <id>\` writes one).",
		severity="warn"
	)
}
`;
	return {
		edits: [
			{ file: kindFile, text: kindText, created: true },
			{ file: indexFile, text: withKind, created: false },
			{ file: grit, text: gritText, created: true },
		],
		plugin: {
			path: grit,
			includes: [
				`${paths.src}/**`,
				`!${paths.src}/**/*${suffix}`,
				`!${paths.src}/**/*.test.ts`,
				`!${paths.src}/**/*.test.tsx`,
			],
		},
		next: [
			`Fill in ${kindFile}: its spec, schema, about, keywords and guards.`,
			`Add a first entry: pnpm new ${name} <object>.<name>. The kernel self-test fails until it has one.`,
		],
	};
}

export function apply(root: string, edits: readonly Edit[]) {
	for (const e of edits) {
		const abs = join(root, e.file);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, e.text);
	}
}

export const reader = (root: string) => (file: string) => {
	const abs = join(root, file);
	return existsSync(abs)
		? readFileSync(abs, "utf8").replace(/\r\n/g, "\n")
		: null;
};
