// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ProviderSpec, SignInMethod, TermsRuns } from "../descriptor.ts";

/** Who started a run: a person, or PrismaLens for an alert or a schedule. */
export type RunStarter = "person" | "alert" | "schedule";

const STRICTNESS: Record<TermsRuns, number> = {
	allowed: 0,
	unknown: 1,
	"interactive-only": 2,
	never: 3,
};

/** The sign-in a run will use; `other` is the one it may use instead, when the CLI's precedence leaves it open. */
export interface AuthPath {
	readonly method: SignInMethod;
	readonly other?: SignInMethod;
}

const hits = (
	m: SignInMethod,
	env: Readonly<Record<string, string | undefined>>,
) =>
	(m.env ?? []).some((e) => {
		const v = env[e.name]?.trim();
		return !!v && (!e.prefix || v.startsWith(e.prefix));
	});

/**
 * The sign-in path a run on this env takes: the first method whose env is set, else the
 * CLI's own stored sign-in. With both, and verdicts that differ, the CLI's documented
 * precedence decides; undocumented or stored-first, the stricter verdict holds (#1252).
 */
export function authPathOf(
	auth: ProviderSpec["auth"],
	env: Readonly<Record<string, string | undefined>>,
): AuthPath | null {
	const methods = auth?.methods ?? [];
	const keyed = methods.find((m) => hits(m, env));
	const stored = methods.find((m) => !m.env);
	if (!keyed) return stored ? { method: stored } : null;
	if (
		!stored ||
		keyed.terms.runs === stored.terms.runs ||
		auth?.precedence?.first === "env"
	)
		return { method: keyed };
	return STRICTNESS[keyed.terms.runs] >= STRICTNESS[stored.terms.runs]
		? { method: keyed, other: stored }
		: { method: stored, other: keyed };
}

/** May a run this starter began use a path with this verdict? */
export function runsUnder(runs: TermsRuns, startedBy: RunStarter): boolean {
	if (runs === "never") return false;
	if (runs === "interactive-only") return startedBy === "person";
	return true;
}

export type TermsGate =
	| { readonly refuse: string }
	| { readonly warn: string }
	| null;

/** Refuse, warn or pass a run by its sign-in path's terms, in the words the user reads. */
export function termsGate(
	agent: { readonly name: string; readonly auth?: ProviderSpec["auth"] },
	env: Readonly<Record<string, string | undefined>>,
	startedBy: RunStarter,
): TermsGate {
	const path = authPathOf(agent.auth, env);
	if (!path) return null;
	const { method, other } = path;
	const { runs, source, gaps } = method.terms;
	if (runs === "unknown")
		return startedBy === "person"
			? null
			: {
					warn: `PrismaLens has not read ${agent.name}'s terms for ${method.label} (${(gaps ?? []).join("; ")}). The run used your own sign-in.`,
				};
	if (runsUnder(runs, startedBy)) return null;
	const said = `its terms say "${source.clause}" (${source.url}).`;
	const which = other
		? ` ${agent.name} may use ${method.label} even with ${other.label} set, and its docs don't say ${other.label} wins, so the stricter terms hold.`
		: "";
	const instead = other ? undefined : fixFor(agent.auth, startedBy);
	const fix = instead ? ` Use ${instead.label} instead.` : "";
	return runs === "never"
		? {
				refuse: `PrismaLens doesn't run ${agent.name} on ${method.label}: ${said}${which}${fix}`,
			}
		: {
				refuse: `Alert and scheduled runs can't use ${agent.name} on ${method.label}: ${said}${which} Start it yourself${instead ? `, or use ${instead.label}` : ""}.`,
			};
}

/** A key path this starter may use that, set, the CLI would take: only where its env wins. */
function fixFor(
	auth: ProviderSpec["auth"],
	startedBy: RunStarter,
): SignInMethod | undefined {
	const methods = auth?.methods ?? [];
	const storedFirst =
		methods.some((m) => !m.env) && auth?.precedence?.first !== "env";
	if (storedFirst) return undefined;
	return methods.find((m) => m.env && runsUnder(m.terms.runs, startedBy));
}
