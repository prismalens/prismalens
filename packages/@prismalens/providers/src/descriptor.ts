// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";

/** The provider families. A member's id is `<family>.<member>`; the member part is what the database stores. */
export const FAMILIES = [
	"agent",
	"code-host",
	"telemetry",
	"alert-intake",
] as const;
export type Family = (typeof FAMILIES)[number];

/**
 * Where a member's id is stored: a column and the value it holds. `where` tells members apart
 * when they share one value, e.g. `git-host-token` rows by their `config.host`.
 */
export interface StoredId {
	readonly column: string;
	readonly value: string;
	readonly where?: { readonly field: string; readonly value: string };
}

/** A kit case a member opts out of, and why: printed in the test name, never silent. */
export interface Skip {
	readonly case: string;
	readonly reason: string;
}

/** How a credential is sent: data the request guard applies, so no host is special-cased in code. */
export type AuthApply =
	| { readonly bearer: string }
	| { readonly basic: { readonly user: string; readonly password: string } }
	| { readonly header: { readonly name: string; readonly value: string } };

const secrets = new WeakSet<z.ZodType>();

/** A secret credential field. Redaction reads this mark, so a secret declared any other way is not one. */
export function secret(meta: { title: string; description?: string }) {
	const s = z
		.string()
		.min(1)
		.meta({ ...meta, secret: true });
	secrets.add(s);
	return s;
}

export const isSecret = (s: z.ZodType): boolean => secrets.has(s);

export interface AuthScheme {
	readonly id: string;
	readonly label: string;
	readonly apply: AuthApply;
	/** Credential fields by name; secrets are built with `secret()`. */
	readonly fields: Readonly<Record<string, z.ZodType>>;
	readonly scopes?: readonly { readonly scope: string; readonly why: string }[];
	/** The git user a clone sends with this scheme's token. */
	readonly git?: { readonly user: string };
	/** The scheme cannot be verified without a workspace or repository. */
	readonly needsTarget?: boolean;
}

/**
 * Which runs PrismaLens may start on a sign-in path, by its vendor's terms: every run,
 * only a person's (no alert or schedule), none, or terms not yet read (runs go ahead).
 */
export const TERMS_RUNS = [
	"allowed",
	"interactive-only",
	"never",
	"unknown",
] as const;
export type TermsRuns = (typeof TERMS_RUNS)[number];

/** A clause as read: verbatim, where, and the UTC date it was read. */
export interface TermsSource {
	readonly url: string;
	readonly clause: string;
	readonly readOn: string;
}

export interface Terms {
	readonly runs: TermsRuns;
	readonly source: TermsSource;
	/** The strongest clause that reads the other way, kept beside the ruling. */
	readonly against?: TermsSource;
	/** Pages that bear on this path and were not read; required when `runs` is `unknown`. */
	readonly gaps?: readonly string[];
}

/** An env var whose value means a run signs in this way; `prefix` narrows it to one kind of key. */
export interface SignInEnv {
	readonly name: string;
	readonly prefix?: string;
	/** It counts only while `name` is unset or is `is`: a key read only by the provider that setting picks. */
	readonly when?: { readonly name: string; readonly is: string };
}

/** A sign-in method an agent's own CLI offers, served as data with its vendor's terms. */
export interface SignInMethod {
	readonly id: string;
	readonly label: string;
	readonly steps: readonly (
		| "browser"
		| "deviceCode"
		| "terminal"
		| "credentials"
	)[];
	/** Set in the run's env, this method is the one in use; absent, it is the CLI's own stored sign-in. */
	readonly env?: readonly SignInEnv[];
	/** The ACP `authenticate` method that picks it; when a run sends it, the agent uses this sign-in. */
	readonly acp?: string;
	readonly terms: Terms;
}

export interface Operation {
	readonly about: string;
	readonly input?: z.ZodType;
}

export interface ProviderSpec<F extends Family = Family> {
	/** `<family>.<member>`, e.g. `code-host.bitbucket`. */
	readonly id: `${F}.${string}`;
	readonly family: F;
	readonly name: string;
	readonly mark: { readonly brand: string } | { readonly letters: string };
	/** The only sort key within a family, so a list never reorders by state. */
	readonly order: number;
	/** The entry points that offer it; each required one of its family must be here or in `skips`. */
	readonly entryPoints: readonly string[];
	readonly stored?: readonly StoredId[];
	/** Older ids that still resolve on read. */
	readonly aliases?: readonly string[];
	readonly skips?: readonly Skip[];
	readonly auth?: {
		readonly schemes?: readonly AuthScheme[];
		readonly methods?: readonly SignInMethod[];
	};
	readonly operations?: Readonly<Record<string, Operation>>;
	/** Non-secret settings; forms render from its JSON Schema and `.meta`. */
	readonly config?: z.ZodType;
}

export type ProviderDef<F extends Family = Family> = ProviderSpec<F> & {
	readonly kind: "provider";
};

/** One provider. Export it from a `*.provider.ts` file; the generator collects it. */
export const defineProvider = <const F extends Family>(
	spec: ProviderSpec<F>,
): ProviderDef<F> => ({ ...spec, kind: "provider" });

export interface EntryPointSpec {
	/** `<page>.<place>`, e.g. `projects.add`. */
	readonly id: string;
	readonly family: Family;
	/** Every member of the family must offer it, or name a skip. */
	readonly required: boolean;
	readonly about: string;
	/** The screen component that renders it, repo-relative; the kit renders this file. */
	readonly screen: string;
}

export type EntryPointDef = EntryPointSpec & { readonly kind: "entryPoint" };

/** One place a family's members are offered. Export it from a `*.entry-points.ts` file. */
export const defineEntryPoint = (spec: EntryPointSpec): EntryPointDef => ({
	...spec,
	kind: "entryPoint",
});

/** Every secret field a member declares, by scheme: the one list redaction reads. */
export function secretFields(p: ProviderSpec): string[] {
	return (p.auth?.schemes ?? []).flatMap((s) =>
		Object.entries(s.fields)
			.filter(([, f]) => isSecret(f))
			.map(([name]) => `${s.id}.${name}`),
	);
}
