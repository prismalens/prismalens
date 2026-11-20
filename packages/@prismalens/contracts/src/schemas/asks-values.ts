// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).

/**
 * Why an ask refuses an answer, and who can give it (#1101 cat 5): the API's
 * refusal and the ask card's note read these same sentences.
 */
export const ASK_REFUSAL = {
	startedByPrismaLens:
		"Only the computer running PrismaLens can answer this: PrismaLens started the run, so its asks stay on that computer.",
	toolAsk:
		"Only the computer running PrismaLens can answer this: a PrismaLens tool asked, and its answers stay on that computer.",
	secret:
		"Only the computer running PrismaLens can answer this: a secret is typed on that computer, never sent from a paired device.",
	run: "A run cannot answer an ask; you answer it, from the thread.",
} as const;
export type AskRefusalReason = keyof typeof ASK_REFUSAL;
