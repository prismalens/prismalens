// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** The engine's prefix on a refused call's result (acp-adapter.ts REFUSAL_PREFIX). */
const REFUSED = /^Refused by PrismaLens's [^:]*policy: ([\s\S]+?)\.?$/;
/** What a harness writes when the gate said no and it was not told why. */
const HARNESS_REFUSED = /user refused permission/i;

/**
 * The gate's reason, without its detail: `reaches a host outside the brief`
 * from `…: reaches a host outside the brief: https://example.com.`. Null when
 * the text is not a refusal.
 */
export function refusalReason(text: string | null | undefined): string | null {
	if (!text) return null;
	const m = REFUSED.exec(text.trim());
	if (m?.[1]) return m[1].split(": ")[0]?.trim() ?? null;
	return HARNESS_REFUSED.test(text) ? "PrismaLens refused it" : null;
}

/** `Not run: it reaches a host outside the brief.` (study-v3 §3.4). */
export function refusalSentence(reason: string): string {
	const plain = /^PrismaLens /.test(reason) ? reason : `it ${reason}`;
	return `Not run: ${plain}.`;
}
