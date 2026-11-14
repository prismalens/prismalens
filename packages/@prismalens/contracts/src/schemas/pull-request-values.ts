// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).
import type { PrHost, PrHostTerms } from "./pull-request.js";

/** Each host kind's terms; the UI renders these and never hard-codes a host's word. */
export const PR_HOST_TERMS: Record<PrHost, PrHostTerms> = {
	github: {
		changeRequest: "pull request",
		short: "PR",
		numberPrefix: "#",
		check: "check",
		checks: "checks",
		ci: "checks",
	},
	gitlab: {
		changeRequest: "merge request",
		short: "MR",
		numberPrefix: "!",
		check: "job",
		checks: "jobs",
		ci: "pipeline",
	},
	other: {
		changeRequest: "pull request",
		short: "PR",
		numberPrefix: "#",
		check: "check",
		checks: "checks",
		ci: "checks",
	},
};

/** A host's terms; an absent or unknown host reads as a pull request with checks. */
export function prHostTerms(host: PrHost | null | undefined): PrHostTerms {
	return PR_HOST_TERMS[host ?? "other"] ?? PR_HOST_TERMS.other;
}

/** `PR #12`, `MR !12`. */
export function prLabel(host: PrHost | null | undefined, n: number): string {
	const t = prHostTerms(host);
	return `${t.short} ${t.numberPrefix}${n}`;
}

/** A term with its first letter upper case, for a label or a sentence start. */
export function capitalTerm(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}
