// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The prefix the removed permission gate put on a refused call's result. Only
 * events stored before #673 w21 carry it; new runs have no PrismaLens refusals.
 */
const REFUSED = /^Refused by PrismaLens's [^:]*policy: ([\s\S]+?)\.?$/;

/**
 * The gate's reason, without its detail: `reaches a host outside the brief`
 * from `…: reaches a host outside the brief: https://example.com.`. Null when
 * the text is not a refusal.
 */
export function refusalReason(text: string | null | undefined): string | null {
	if (!text) return null;
	const m = REFUSED.exec(text.trim());
	return m?.[1] ? (m[1].split(": ")[0]?.trim() ?? null) : null;
}

/** `Not run: it reaches a host outside the brief.` (study-v3 §3.4). */
export function refusalSentence(reason: string): string {
	const plain = /^PrismaLens /.test(reason) ? reason : `it ${reason}`;
	return `Not run: ${plain}.`;
}
