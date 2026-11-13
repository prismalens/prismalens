// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Collected } from "./collect.ts";
import { type AnyKind, type Guard, type GuardCtx, guard } from "./kind.ts";
import { fieldAt, type Manifest, stringsIn } from "./manifest.ts";

/** One failed check: which kind, which guard, what is wrong and what to do. */
export interface Problem {
	readonly kind: string;
	readonly guard: string;
	readonly problem: string;
	readonly fix: string;
}

const REGEN =
	"Run `pnpm registry gen` and commit registry.gen.ts and registry.manifest.json.";

/** Each id once per kind, in the manifest and at runtime. */
export const unique = guard(
	"unique",
	"Rename one of the two definitions; an id names one thing.",
	(c) => {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const e of c.entries) {
			if (seen.has(e.id))
				out.push(`${c.kind} "${e.id}" is defined twice (${e.file})`);
			seen.add(e.id);
		}
		return out;
	},
);

/** The manifest lists exactly what the collector found. */
export const fresh = guard("fresh", REGEN, (c) => {
	const live = c.live(c.kind);
	const listed = new Set(c.entries.map((e) => e.id));
	return [
		...Array.from(live.keys())
			.filter((id) => !listed.has(id))
			.map((id) => `${c.kind} "${id}" runs but the manifest does not list it`),
		...Array.from(listed)
			.filter((id) => !live.has(id))
			.map(
				(id) => `${c.kind} "${id}" is in the manifest but nothing defines it`,
			),
	];
});

/** Every field a kind marks as a ref names an id of the kind it points at. */
export const refsResolve = guard(
	"refs",
	"Use an id that exists (`pnpm registry ls <kind>`), or define it first.",
	(c) => {
		const kind = c.manifest.kinds[c.kind];
		if (!kind) return [];
		const out: string[] = [];
		for (const [path, target] of Object.entries(kind.refs)) {
			const ids = new Set((c.manifest.entries[target] ?? []).map((e) => e.id));
			if (!c.manifest.kinds[target]) {
				out.push(
					`${c.kind}.${path} points at kind "${target}", which is not registered`,
				);
				continue;
			}
			for (const e of c.entries)
				for (const id of stringsIn(fieldAt(e.fields, path)))
					if (id !== "-" && !ids.has(id))
						out.push(
							`${c.kind} "${e.id}" ${path} names ${target} "${id}", which does not exist`,
						);
		}
		return out;
	},
);

/** A kind with no entries is speculative; a kind with no guard is unchecked. */
export const populated = guard(
	"populated",
	"Add a first entry with `pnpm new <kind> <id>`, or remove the kind.",
	(c) => {
		const kind = c.manifest.kinds[c.kind];
		const out: string[] = [];
		if (c.entries.length === 0) out.push(`kind "${c.kind}" has no entries`);
		if (kind && kind.guards.length === 0)
			out.push(`kind "${c.kind}" lists no guards`);
		return out;
	},
);

/** The guards every kind gets before its own. */
export const GENERIC_GUARDS: readonly Guard[] = [
	unique,
	fresh,
	refsResolve,
	populated,
];

function schemaProblems(
	kind: AnyKind,
	live: ReadonlyMap<string, unknown>,
): string[] {
	const out: string[] = [];
	for (const [id, value] of Array.from(live)) {
		const r = kind.schema["~standard"].validate(value);
		if (r instanceof Promise) {
			out.push(
				`${kind.name} "${id}": its schema validates asynchronously; kinds need a sync schema`,
			);
			continue;
		}
		for (const issue of r.issues ?? [])
			out.push(`${kind.name} "${id}": ${issue.message}`);
	}
	return out;
}

/**
 * Runs the generic guards, then each kind's own, over the manifest and the
 * live entries. An empty list means the registry holds together.
 */
export function runGuards(
	kinds: readonly AnyKind[],
	manifest: Manifest,
	collected: Collected,
): Problem[] {
	const problems: Problem[] = [];
	const add = (
		kind: string,
		g: Pick<Guard, "name" | "fix">,
		list: readonly string[],
	) => {
		for (const problem of list)
			problems.push({ kind, guard: g.name, problem, fix: g.fix });
	};
	add(
		"*",
		{ name: "collect", fix: "Give each id one definition." },
		collected.dupes,
	);
	add(
		"*",
		{
			name: "placement",
			fix: "Move the definition into a file with its kind's suffix.",
		},
		collected.strays,
	);
	const names = new Set(kinds.map((k) => k.name));
	for (const name of Object.keys(manifest.kinds))
		if (!names.has(name))
			add(name, { name: "fresh", fix: REGEN }, [
				`kind "${name}" is in the manifest but not registered`,
			]);
	for (const kind of kinds) {
		if (!manifest.kinds[kind.name]) {
			add(kind.name, { name: "fresh", fix: REGEN }, [
				`kind "${kind.name}" is missing from the manifest`,
			]);
			continue;
		}
		const ctx: GuardCtx = {
			manifest,
			kind: kind.name,
			entries: manifest.entries[kind.name] ?? [],
			live: collected.of,
		};
		add(
			kind.name,
			{ name: "schema", fix: "Make the definition match its kind's schema." },
			schemaProblems(kind, collected.of(kind.name)),
		);
		for (const g of [...GENERIC_GUARDS, ...kind.guards])
			add(kind.name, g, g.check(ctx));
	}
	return problems;
}

/** One line per problem, for a test failure or the CLI. */
export const formatProblems = (problems: readonly Problem[]): string[] =>
	problems.map((p) => `[${p.kind}/${p.guard}] ${p.problem}. Fix: ${p.fix}`);
