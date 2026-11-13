// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Scaffold } from "./kind.ts";

/** A JSON value the generator could read as a literal from source. */
export type Literal =
	| string
	| number
	| boolean
	| null
	| readonly Literal[]
	| { readonly [key: string]: Literal };

export interface ManifestKind {
	/** The kind file, relative to the app root. */
	readonly file: string;
	readonly suffix: string;
	readonly about: string;
	readonly refs: Readonly<Record<string, string>>;
	readonly guards: readonly string[];
	readonly aliases: readonly string[];
	readonly keywords: readonly string[];
	readonly scaffold?: Scaffold;
}

export interface ManifestEntry {
	readonly id: string;
	/** The file that defines it, relative to the app root. */
	readonly file: string;
	/** The exported name it is bound to. */
	readonly export: string;
	/** Every field whose value is a literal in source; functions and imported values are absent. */
	readonly fields: { readonly [key: string]: Literal };
}

/** Where the app renders a kind's ids, e.g. `<Surface id="thread.row">`. */
export interface ManifestUse {
	readonly id: string;
	readonly file: string;
}

/** `registry.manifest.json`: written by `pnpm registry gen`, read by the guards and the CLI. */
export interface Manifest {
	readonly version: 1;
	readonly kinds: Readonly<Record<string, ManifestKind>>;
	readonly entries: Readonly<Record<string, readonly ManifestEntry[]>>;
	/** Ids the design gallery draws: `<Stage id>`, `data-kit-state` and `{ id, title }` sections. */
	readonly gallery: readonly string[];
	readonly uses: Readonly<Record<string, readonly ManifestUse[]>>;
	/** Closed sets by name: each member's literal view, plus `pathExists` when a view names a `path`. */
	readonly closed?: Readonly<Record<string, ManifestClosed>>;
	/** Tests that declare coverage with `@cond:`, `@walk:` and `@surface:` tags. */
	readonly cases?: readonly ManifestCase[];
	/** While true, a condition's `ci: { debt: "climb" }` counts as covered (and is ratcheted). */
	readonly climb?: boolean;
}

export interface ManifestClosed {
	readonly file: string;
	readonly members: Readonly<
		Record<string, { readonly [key: string]: Literal }>
	>;
}

export interface ManifestCase {
	readonly file: string;
	readonly conditions: readonly string[];
	readonly walks: readonly string[];
	readonly surfaces: readonly string[];
}

/** Reads a dotted path such as `menus.more` out of an entry's literal fields. */
export function fieldAt(
	fields: ManifestEntry["fields"],
	path: string,
): Literal | undefined {
	let at: Literal | undefined = fields;
	for (const part of path.split(".")) {
		if (at === null || typeof at !== "object" || Array.isArray(at))
			return undefined;
		at = (at as { readonly [key: string]: Literal })[part];
	}
	return at;
}

/** Every string inside a literal, flattened: a ref field may be one id or a list of them. */
export function stringsIn(v: Literal | undefined): string[] {
	if (typeof v === "string") return [v];
	if (Array.isArray(v)) return v.flatMap((x) => stringsIn(x));
	return [];
}
