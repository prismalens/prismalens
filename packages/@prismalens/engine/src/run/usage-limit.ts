// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * How a usage-limit error opens. Claude's: claude-agent-sdk 0.3.304
 * `USAGE_LIMIT_ERROR_PREFIXES`; Codex's: the text of its `usageLimitExceeded` error.
 */
const LIMIT_OPENINGS = [
	"you've hit your",
	"you've reached your",
	"you're out of usage credits",
	"you're out of extra usage",
	"your org is out of usage",
	"your seat type doesn't include usage",
	"your seat type doesn't include extra usage",
	"your usage allocation has been disabled",
	"your group's usage limit is set to $0",
	"requires usage credits",
	"usage limit reached",
];

/** The agent stopped because its account ran out of usage, not because the run went wrong. */
export function isUsageLimitError(text: string | null | undefined): boolean {
	if (!text) return false;
	const said = text.replace(/[‘’]/g, "'").toLowerCase();
	return LIMIT_OPENINGS.some((opening) => said.includes(opening));
}

/**
 * Codex sends its usage-limit text in the error's `data`, under a generic
 * JSON-RPC message; the text a person reads is lifted out of it.
 */
export function usageLimitText(
	message: string,
	data: string | undefined,
): string | null {
	if (isUsageLimitError(message)) return message;
	if (!data?.includes("usageLimitExceeded")) return null;
	const quoted = /"message":("(?:[^"\\]|\\.)*")/.exec(data)?.[1];
	let said: string | null = null;
	try {
		said = quoted ? (JSON.parse(quoted) as string) : null;
	} catch {
		said = null;
	}
	return said && isUsageLimitError(said)
		? said
		: `Usage limit reached: ${message}`;
}
