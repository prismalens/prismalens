// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Manifest, ManifestEntry } from "./manifest.ts";

/** The validation half of the Standard Schema interface, which zod and its peers implement. */
export interface Schema {
	readonly "~standard": {
		readonly validate: (
			value: unknown,
		) =>
			| { readonly issues?: readonly { readonly message: string }[] }
			| Promise<unknown>;
	};
}

/** What every registered thing is at runtime: its kind's name and a literal id. */
export interface Entry<K extends string = string> {
	readonly kind: K;
	readonly id: string;
}

/** What a guard sees: the committed manifest and the entries the collector found at runtime. */
export interface GuardCtx {
	readonly manifest: Manifest;
	/** The kind this guard runs for. */
	readonly kind: string;
	/** This kind's manifest entries. */
	readonly entries: readonly ManifestEntry[];
	/** Every kind's live entries by id. */
	readonly live: (kind: string) => ReadonlyMap<string, Entry>;
}

/** One check over the manifest; each problem it returns is a sentence, and `fix` says what to do. */
export interface Guard {
	readonly name: string;
	readonly fix: string;
	readonly check: (ctx: GuardCtx) => readonly string[];
}

export function guard(
	name: string,
	fix: string,
	check: (ctx: GuardCtx) => readonly string[],
): Guard {
	return { name, fix, check };
}

/** A kind's define function: takes a definition, returns the entry the collector reads. */
export type DefineFn<N extends string> = (...args: never[]) => Entry<N>;

/**
 * A kind is a blueprint: the file suffix its entries live in, the schema each
 * entry must pass, the fields that name other kinds' ids, and at least one guard.
 * `name`, `suffix`, `about`, `refs`, `aliases` and `uses` must be literals: the generator reads them from source.
 */
export interface Kind<
	N extends string = string,
	D extends DefineFn<N> = DefineFn<N>,
> {
	readonly name: N;
	/** Entries live only in files ending with this, e.g. `.actions.ts`. */
	readonly suffix: `.${string}.ts`;
	/** One line for `pnpm registry where`: what an entry of this kind is. */
	readonly about: string;
	readonly schema: Schema;
	/** Dotted field path → the kind whose ids it holds, e.g. `"menus.more": "action"`. */
	readonly refs: Readonly<Record<string, string>>;
	/** A kind without a guard does not compile. */
	readonly guards: readonly [Guard, ...Guard[]];
	readonly define: D;
	/** Older names for `define.<kind>` that still count as entries, e.g. `defineAction`. */
	readonly aliases?: readonly string[];
	/** JSX components whose `id` prop renders an entry, and a raw attribute that does the same. */
	readonly uses?: {
		readonly components?: readonly string[];
		readonly attribute?: string;
	};
}

export function defineKind<const N extends string, D extends DefineFn<N>>(
	kind: Kind<N, D>,
): Kind<N, D> {
	if (kind.guards.length === 0)
		throw new Error(`kind "${kind.name}" needs at least one guard`);
	return kind;
}

export type AnyKind = Kind<string, DefineFn<string>>;

/** `define.<kind>` for every kind in the list: the only way to add an entry. */
export type Define<K extends readonly AnyKind[]> = {
	readonly [P in K[number] as P["name"]]: P["define"];
};

export function makeDefine<const K extends readonly AnyKind[]>(
	kinds: K,
): Define<K> {
	const seen = new Set<string>();
	const out: Record<string, DefineFn<string>> = {};
	for (const k of kinds) {
		if (seen.has(k.name)) throw new Error(`kind "${k.name}" is listed twice`);
		seen.add(k.name);
		out[k.name] = k.define;
	}
	return out as Define<K>;
}

/** Builds an entry of kind `name`: what a kind's own typed define function returns. */
export function entry<
	const N extends string,
	T extends { readonly id: string },
>(name: N, def: T): T & { readonly kind: N } {
	return { kind: name, ...def };
}
