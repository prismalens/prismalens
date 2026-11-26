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

type Env = Readonly<Record<string, string | undefined>>;
type Auth = ProviderSpec["auth"];

/** The sign-in a run will use; `other` is the one it may use instead, when the CLI's precedence leaves it open. */
export interface AuthPath {
	readonly method: SignInMethod;
	readonly other?: SignInMethod;
}

const hits = (m: SignInMethod, env: Env) =>
	(m.env ?? []).some((e) => {
		const v = env[e.name]?.trim();
		return !!v && (!e.prefix || v.startsWith(e.prefix));
	});

/** Does setting `m`'s env make the CLI use it: its env wins, or the run then sends its ACP method? */
const wins = (auth: Auth, m: SignInMethod) =>
	!!m.acp ||
	auth?.precedence?.first === "env" ||
	!(auth?.methods ?? []).some((s) => !s.env);

/**
 * The sign-in path a run takes. The ACP method it sends decides first; else the first
 * method whose env is set, else the CLI's stored sign-in. Where both may apply and the
 * CLI's precedence is not documented as env-first, the stricter verdict holds (#1252).
 */
export function authPathOf(
	auth: Auth,
	env: Env,
	sent?: string | null,
): AuthPath | null {
	const methods = auth?.methods ?? [];
	// A key known by its shape (a Coding Plan key) is that plan's, whichever method carries it.
	const shaped = methods.find(
		(m) => m.env?.some((e) => e.prefix) && hits(m, env),
	);
	if (shaped) return { method: shaped };
	const picked = sent ? methods.find((m) => m.acp === sent) : undefined;
	if (picked) return { method: picked };
	const keyed = methods.find((m) => hits(m, env));
	const stored = methods.find((m) => !m.env);
	if (!keyed) return stored ? { method: stored } : null;
	if (!stored || keyed.terms.runs === stored.terms.runs || wins(auth, keyed))
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
	agent: { readonly name: string; readonly auth?: Auth },
	env: Env,
	startedBy: RunStarter,
	sent?: string | null,
): TermsGate {
	const path = authPathOf(agent.auth, env, sent);
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
		? ` ${agent.name} may use ${method.label} even with ${other.label} set, and its docs don't say which wins, so the stricter terms hold.`
		: "";
	const lead =
		runs === "never"
			? `PrismaLens doesn't run ${agent.name} on ${method.label}`
			: `Alert and scheduled runs can't use ${agent.name} on ${method.label}`;
	const yourself = runs === "never" ? "" : " Start it yourself, or";
	return {
		refuse: `${lead}: ${said}${which}${switchTo(agent, method, startedBy, yourself)}`,
	};
}

/** How to reach a path this starter may use: a key that wins, else signing out first. */
function switchTo(
	agent: { readonly name: string; readonly auth?: Auth },
	from: SignInMethod,
	startedBy: RunStarter,
	yourself: string,
): string {
	const to = (agent.auth?.methods ?? []).find(
		(m) =>
			m !== from &&
			m.env &&
			!m.env.some((e) => e.prefix) &&
			runsUnder(m.terms.runs, startedBy),
	);
	if (!to) return yourself ? `${yourself.replace(/, or$/, ".")}` : "";
	const step = from.env?.some((e) => e.prefix)
		? `put a key from outside the plan in ${to.label}`
		: !from.env && !wins(agent.auth, to)
			? `sign out of ${agent.name}'s own sign-in and use ${to.label}`
			: `use ${to.label} instead`;
	return `${yourself || " To run it,"} ${step}.`;
}
