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
}

const KNOWN: { test: RegExp; words: FailureWords }[] = [
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
		test: /not logged in|unauthori[sz]ed|\b401\b|\b403\b|api key|sign(ed)? in/i,
		words: {
			what: "The agent is not signed in to its model provider.",
			next: "Sign the agent in, then try again.",
		},
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

/** A failed investigation's error as a sentence an operator can act on (#743). */
export function failureWords(error: string | null | undefined): FailureWords {
	if (!error) return { what: "No error was recorded." };
	for (const k of KNOWN) if (k.test.test(error)) return k.words;
	const clause = firstClause(error);
	return { what: /[.!?]$/.test(clause) ? clause : `${clause}.` };
}
