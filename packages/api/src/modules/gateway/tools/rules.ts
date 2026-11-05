// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** What every tool description ends with (#1024 spec F, decision 6). */
export const HOUSE_RULES =
	"Show the user links, not ids. On failure, follow `next`.";

/** A description that says when to use the tool, when not, and the house rules; a test holds every tool to it. */
export const withRules = (text: string, notFor: string): string =>
	`${text} Not for ${notFor} ${HOUSE_RULES}`;
