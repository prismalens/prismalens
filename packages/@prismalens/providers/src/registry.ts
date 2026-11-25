// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { FAMILIES, type Family, type ProviderDef } from "./descriptor.ts";

/** Typed ids. A module that ships members adds keys by declaration merging: `interface ProviderIdMap { "code-host.gitea": true }`. */
// biome-ignore lint/suspicious/noEmptyInterface: keys arrive from the generated barrel and from contributing modules.
export interface ProviderIdMap {}
export type ProviderId = keyof ProviderIdMap & string;

const isProvider = (v: unknown): v is ProviderDef =>
	typeof v === "object" &&
	v !== null &&
	(v as ProviderDef).kind === "provider" &&
	typeof (v as ProviderDef).id === "string";

/** What a stored id resolves to: a member, or why it can't be used, so its data is kept and shown as unavailable. */
export type Resolved =
	| { readonly ok: true; readonly provider: ProviderDef }
	| { readonly ok: false; readonly id: string; readonly reason: string };

/**
 * Every provider the app knows: the built-in members from the generated barrel, plus what
 * modules contribute at boot. A duplicate id or unknown family throws, naming the module.
 */
export class ProviderRegistry {
	readonly #byId = new Map<string, { provider: ProviderDef; from: string }>();
	readonly #alias = new Map<string, string>();

	constructor(
		builtIn: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
	) {
		for (const [file, mod] of Object.entries(builtIn))
			this.contribute(file, Object.values(mod).filter(isProvider));
	}

	/** Adds a module's members; call it once per module, from its `onModuleInit`. */
	contribute(from: string, members: readonly ProviderDef[]): void {
		for (const p of members) {
			if (!(FAMILIES as readonly string[]).includes(p.family))
				throw new Error(
					`provider ${p.id} from ${from} names unknown family ${p.family}`,
				);
			for (const id of [p.id, ...(p.aliases ?? [])]) {
				const held = this.#byId.get(this.#alias.get(id) ?? id)?.from;
				if (held !== undefined)
					throw new Error(
						`duplicate provider ${id} from ${from} (already from ${held})`,
					);
			}
			this.#byId.set(p.id, { provider: p, from });
			for (const a of p.aliases ?? []) this.#alias.set(a, p.id);
		}
	}

	/** A family's members in their declared order. */
	list(family: Family): ProviderDef[] {
		return Array.from(this.#byId.values())
			.map((v) => v.provider)
			.filter((p) => p.family === family)
			.sort((a, b) => a.order - b.order);
	}

	/** A stored id, following aliases; an id no module provides reads as unavailable, never as an error. */
	resolve(id: string): Resolved {
		const canonical = this.#alias.get(id) ?? id;
		const hit = this.#byId.get(canonical);
		return hit
			? { ok: true, provider: hit.provider }
			: {
					ok: false,
					id,
					reason: `No installed module provides ${id}; its saved settings are kept.`,
				};
	}
}
