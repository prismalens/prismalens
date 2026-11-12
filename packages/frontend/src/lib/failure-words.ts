// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { firstClause } from "./incident-board";

export interface FailureWords {
	/** What happened, in the operator's words. */
	what: string;
	/** What to do about it, when there is something to say. */
	next?: string;
	/** PrismaLens said it, not the agent, so it is never quoted as the agent's words. */
	ours?: boolean;
	/** Said plainly, the agent's raw words only as detail (#673 w5-39). */
	plain?: boolean;
}

const KNOWN: {
	test: RegExp;
	words: FailureWords | ((agent: string, hint?: string) => FailureWords);
}[] = [
	// API account stops first (#1101): a rejected key is never "sign in", a 401 included.
	{
		test: /credit balance is too low|out of credit|billing_error|credit_balance_exhausted|insufficient_quota|check your plan and billing|\b402\b/i,
		words: (agent) => ({
			what: `${cap(agent)} is out of credit on its API account.`,
			next: "Add credit on the provider's billing page, then try again.",
			plain: true,
		}),
	},
	{
		test: /spend(ing)? (cap|limit)|spend_limit_exceeded|specified (workspace )?api usage limit/i,
		words: {
			what: "Your organization's spend cap was reached.",
			next: "Raise the cap on the provider's limits page, or switch to another agent.",
			plain: true,
		},
	},
	{
		test: /invalid x-api-key|incorrect api key|invalid api key|api key not valid|api_key_invalid|authentication_error|reported as leaked|\b401\b/i,
		words: (agent) => ({
			what: `${cap(agent)}'s API key was rejected.`,
			next: "Update the key in the agent's settings, then try again.",
			plain: true,
		}),
	},
	{
		test: /\b529\b|overloaded/i,
		words: {
			what: "The model provider was busy.",
			next: "Nothing is wrong with your setup. Try again in a minute, or pick another model.",
			plain: true,
		},
	},
	{
		test: /\b429\b|rate.?limit/i,
		words: {
			what: "The model provider limited the request rate.",
			next: "Try again in a minute, or pick another model.",
			plain: true,
		},
	},
	{
		test: /failed to authenticate|oauth|session (has )?expired|token (has )?expired|log ?in again/i,
		words: (agent) => ({
			what: `${cap(agent)}'s sign-in has expired.`,
			next: `Sign in to ${agent} again, then start a new run.`,
			plain: true,
		}),
	},
	{
		test: /not logged in|auth(entication)?[ _]required|unauthori[sz]ed|\b403\b|sign(ed)? in|\/login/i,
		words: (agent, hint) => notSignedIn(agent, hint),
	},
	{
		test: /timed? ?out/i,
		words: {
			what: "The agent took too long to answer.",
			next: "Try again; a smaller brief can help.",
		},
	},
	{
		test: /did not validate|could not parse|invalid report/i,
		words: {
			what: "The agent's report could not be read.",
			next: "Try again, or pick another model.",
			ours: true,
		},
	},
	{
		test: /produced no evidence/i,
		words: {
			what: "The agent finished without running a single check, so there is no report.",
			next: "Try again, or pick another model.",
			ours: true,
		},
	},
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A signed-out agent, the same words in the agent picker and a failed run (#831 v5-39, w7-3). */
export function notSignedIn(agent: string, hint?: string): FailureWords {
	// The agent's own sign-in command, e.g. `codex login`, when its settings name one.
	const command = hint?.match(/`([^`]+)`/)?.[1];
	return {
		what: `${cap(agent)} is not signed in to its model provider.`,
		next: command
			? `Run ${command} in a terminal, then retry.`
			: "Sign in with its own CLI, then retry.",
		plain: true,
	};
}

/** `what` and `next` as one line, for a surface with room for one. */
export function failureLine(words: FailureWords): string {
	return words.next ? `${words.what} ${words.next}` : words.what;
}

/** A failed investigation's error as a sentence an operator can act on (#743). */
export function failureWords(
	error: string | null | undefined,
	agent = "the agent",
	hint?: string,
): FailureWords {
	if (!error) return { what: "No error was recorded." };
	for (const k of KNOWN)
		if (k.test.test(error))
			return typeof k.words === "function" ? k.words(agent, hint) : k.words;
	const clause = firstClause(
		error.replace(/^(?:internal error|api error|error)\s*:\s*/i, ""),
	);
	return { what: /[.!?]$/.test(clause) ? clause : `${clause}.` };
}
