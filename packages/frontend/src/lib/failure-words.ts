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
	words: FailureWords | ((agent: string) => FailureWords);
}[] = [
	{
		test: /\b529\b|overloaded/i,
		words: {
			what: "The model provider was overloaded.",
			next: "Nothing is wrong with your setup. Try again in a minute.",
		},
	},
	{
		test: /\b429\b|rate.?limit/i,
		words: {
			what: "The model provider limited the request rate.",
			next: "Try again in a minute, or pick another model.",
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
		test: /not logged in|auth(entication)?[ _]required|unauthori[sz]ed|\b401\b|\b403\b|api key|sign(ed)? in/i,
		words: (agent) => notSignedIn(agent),
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
export function notSignedIn(agent: string): FailureWords {
	return {
		what: `${cap(agent)} is not signed in to its model provider.`,
		next: "Sign in with its own CLI, then retry.",
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
): FailureWords {
	if (!error) return { what: "No error was recorded." };
	for (const k of KNOWN)
		if (k.test.test(error))
			return typeof k.words === "function" ? k.words(agent) : k.words;
	const clause = firstClause(error);
	return { what: /[.!?]$/.test(clause) ? clause : `${clause}.` };
}
