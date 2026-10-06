// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { failureWords } from "./failure-words";
import { harnessWords } from "./report-view";

const MAX = 200;

/**
 * One sentence for a failed run, the same in the conversation, the report and
 * the overview (look ruling L47): the agent's own words, verbatim to their
 * first line, and what to do when there is something to say.
 */
export function failureSentence(
	agent: string,
	error: string | null | undefined,
): { said: string; words: string | null; next?: string } {
	if (!error) return { said: "No error was recorded.", words: null };
	const line = harnessWords(error).split("\n")[0]?.trim() ?? "";
	const words = line.length > MAX ? `${line.slice(0, MAX - 1)}…` : line;
	return {
		said: `${agent} answered "${words}".`,
		words,
		next: failureWords(error).next,
	};
}
