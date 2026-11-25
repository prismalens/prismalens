// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { guard, stringsIn } from "@prismalens/registry";
import { z } from "zod";
import {
	type EntryPointDef,
	FAMILIES,
	isSecret,
	type ProviderDef,
} from "../descriptor.ts";

const MEMBER = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const providers = (live: ReadonlyMap<string, unknown>) =>
	Array.from(live.values()) as ProviderDef[];

/** `<family>.<member>`: the family is a known one and matches the entry's `family`. */
export const idInFamily = guard(
	"id-in-family",
	"Name it <family>.<member> with a lower-case member, e.g. code-host.gitea.",
	(c) =>
		providers(c.live("provider")).flatMap((p) => {
			const [family, ...rest] = p.id.split(".");
			const member = rest.join(".");
			if (!(FAMILIES as readonly string[]).includes(p.family))
				return [
					`provider "${p.id}" names family "${p.family}", which is not one of ${FAMILIES.join(", ")}`,
				];
			if (family !== p.family || !MEMBER.test(member))
				return [`provider "${p.id}" is not "${p.family}.<member>"`];
			return [];
		}),
);

/** `order` is the only sort key, so two members of a family never share one. */
export const orderUnique = guard(
	"order-unique",
	"Give each member of a family its own order; new members take the family's highest plus 10.",
	(c) => {
		const seen = new Map<string, string>();
		return providers(c.live("provider")).flatMap((p) => {
			const key = `${p.family}:${p.order}`;
			const other = seen.get(key);
			if (!other) seen.set(key, p.id);
			return other
				? [`provider "${p.id}" and "${other}" share order ${p.order}`]
				: [];
		});
	},
);

/** Each member offers every required entry point of its family, or names a skip; none offers another family's. */
export const entryPointsDeclared = guard(
	"entry-point-required",
	'Add the entry point to the provider\'s entryPoints, or a skip { case: "entry-point:<id>", reason } saying why it cannot be offered there.',
	(c) => {
		const points = Array.from(c.live("entryPoint").values()) as EntryPointDef[];
		return providers(c.live("provider")).flatMap((p) => {
			const skipped = new Set((p.skips ?? []).map((s) => s.case));
			const out: string[] = [];
			for (const e of points) {
				if (e.family !== p.family) {
					if (p.entryPoints.includes(e.id))
						out.push(
							`provider "${p.id}" lists entry point "${e.id}", which belongs to family ${e.family}`,
						);
					continue;
				}
				if (
					e.required &&
					!p.entryPoints.includes(e.id) &&
					!skipped.has(`entry-point:${e.id}`)
				)
					out.push(`${p.id} misses ${e.id}`);
			}
			return out;
		});
	},
);

/** True when a JSON Schema marks any field secret. */
const marksSecret = (s: z.ZodType): boolean =>
	JSON.stringify(z.toJSONSchema(s, { unrepresentable: "any" })).includes(
		'"secret":true',
	);

/** Secrets live only in auth scheme fields, each built with `secret()`, because redaction reads only those. */
export const secretsMarked = guard(
	"secret-fields",
	"Declare a credential with secret() directly in an auth scheme's fields; keep config free of secrets.",
	(c) =>
		providers(c.live("provider")).flatMap((p) => {
			const out: string[] = [];
			if (p.config && marksSecret(p.config))
				out.push(`provider "${p.id}" config declares a secret field`);
			for (const s of p.auth?.schemes ?? [])
				for (const [name, f] of Object.entries(s.fields))
					if (marksSecret(f) && !isSecret(f))
						out.push(
							`provider "${p.id}" scheme ${s.id} field ${name} is marked secret but not built with secret() (wrapped or nested)`,
						);
			return out;
		}),
);

/** An entry point's family is a known one, and its screen is a component file. */
export const entryPointShape = guard(
	"entry-point-shape",
	"Give the entry point a family from the closed list and a screen path ending in .tsx.",
	(c) =>
		(Array.from(c.live("entryPoint").values()) as EntryPointDef[]).flatMap(
			(e) => [
				...((FAMILIES as readonly string[]).includes(e.family)
					? []
					: [`entry point "${e.id}" names unknown family "${e.family}"`]),
				...(e.screen.endsWith(".tsx")
					? []
					: [`entry point "${e.id}" screen "${e.screen}" is not a .tsx file`]),
			],
		),
);

/** Ids a provider's `aliases` keep alive never collide with a live id. */
export const aliasesFree = guard(
	"aliases",
	"Drop the alias, or rename the provider that now holds that id.",
	(c) => {
		const ids = new Set(c.entries.map((e) => e.id));
		return c.entries.flatMap((e) =>
			stringsIn(e.fields.aliases)
				.filter((a) => ids.has(a))
				.map((a) => `provider "${e.id}" aliases "${a}", which is a live id`),
		);
	},
);
