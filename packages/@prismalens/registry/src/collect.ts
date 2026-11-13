// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AnyKind, Entry } from "./kind.ts";

export interface Collected {
	/** A kind's entries by id; empty for a kind with none. */
	readonly of: (kind: string) => ReadonlyMap<string, Entry>;
	/** The file each entry came from, keyed `kind:id`. */
	readonly fileOf: (kind: string, id: string) => string | undefined;
	/** `kind:id (file)` for each id defined a second time. */
	readonly dupes: readonly string[];
	/** Entries in a file whose suffix belongs to another kind, or of a kind not in the list. */
	readonly strays: readonly string[];
	/** How long collecting took, in milliseconds. */
	readonly ms: number;
}

const isEntry = (v: unknown): v is Entry =>
	typeof v === "object" &&
	v !== null &&
	typeof (v as Entry).kind === "string" &&
	typeof (v as Entry).id === "string";

/**
 * One pass over every export of every collected module (a glob keyed by path):
 * each export that is an entry of a listed kind joins that kind's map.
 */
export function collect(
	kinds: readonly AnyKind[],
	modules: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Collected {
	const start = performance.now();
	const byKind = new Map<string, Map<string, Entry>>(
		kinds.map((k) => [k.name, new Map()]),
	);
	const suffixOf = new Map(kinds.map((k) => [k.name, k.suffix]));
	const files = new Map<string, string>();
	const dupes: string[] = [];
	const strays: string[] = [];
	for (const [file, mod] of Object.entries(modules))
		for (const v of Object.values(mod)) {
			if (!isEntry(v)) continue;
			const into = byKind.get(v.kind);
			const suffix = suffixOf.get(v.kind);
			if (!into || !suffix || !file.endsWith(suffix)) {
				strays.push(`${v.kind}:${v.id} (${file})`);
				continue;
			}
			if (into.has(v.id)) dupes.push(`${v.kind}:${v.id} (${file})`);
			into.set(v.id, v);
			files.set(`${v.kind}:${v.id}`, file);
		}
	const ms = performance.now() - start;
	const none = new Map<string, Entry>();
	return {
		of: (kind) => byKind.get(kind) ?? none,
		fileOf: (kind, id) => files.get(`${kind}:${id}`),
		dupes,
		strays,
		ms,
	};
}
