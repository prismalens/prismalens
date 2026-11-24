// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { failureSource, failureWords } from "./failure-words";
import { harnessWords } from "./report-view";
import type { StopSource } from "./stop-causes";

const MAX = 200;

/** The first line that says something: not blank, a bare bracket or an `Error:` heading. */
function firstWords(error: string | null | undefined): string {
	const lines = harnessWords(error ?? "")
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => /[A-Za-z0-9À-￿]/.test(l));
	return lines.find((l) => !/^(error|exception)\W*$/i.test(l)) ?? "";
}

const cut = (line: string) =>
	line.length > MAX ? `${line.slice(0, MAX - 1)}…` : line;

/**
 * One sentence for a failed run, the same in the conversation, the report and
 * the overview (look ruling L47): the agent's own words, verbatim to their
 * first line, and what to do when there is something to say. A failure
 * PrismaLens itself named reads as a plain sentence, its raw text as `detail`.
 */
/** The run status line: a failure PrismaLens named carries what to do, as the conversation shows it. */
export function failureStatusLine(
	agent: string,
	error: string | null | undefined,
	hint?: string,
): string {
	const s = failureSentence(agent, error, hint);
	return s.detail && s.next ? `${s.said} ${s.next}` : s.said;
}

export function failureSentence(
	agent: string,
	error: string | null | undefined,
	/** The agent's sign-in line from its settings, so a signed-out run names the command. */
	hint?: string,
): {
	said: string;
	words: string | null;
	next?: string;
	detail?: string;
	/** Who raised it, which names the raw words under the sentence. */
	source?: StopSource;
} {
	const line = firstWords(error);
	if (!error || !line) {
		const none = failureWords(null);
		return { said: `${none.what} ${none.next}`, words: null };
	}
	const known = failureWords(error, agent, hint);
	if (known.ours || known.plain) {
		return {
			said: known.what,
			words: null,
			next: known.next,
			detail: cut(line),
			source: failureSource(known),
		};
	}
	const words = cut(line);
	return {
		said: `${agent} answered "${words}".`,
		words,
		next: known.next,
	};
}
