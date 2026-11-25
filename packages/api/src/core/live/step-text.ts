// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { safeParseJsonObject } from "../../shared/utils/json-utils.js";

/**
 * Branches whose events are not the agent's output: an ask, a watch, the tree, a link, the report,
 * the workspace setup. Literals, as importing their modules cycles through PrismaService (#1181).
 */
export const NON_AGENT_BRANCHES: ReadonlySet<string> = new Set([
	"asks",
	"watches",
	"tree",
	"__links__",
	"__report__",
	"workspace",
]);

/** The text of a stored step event, trimmed and capped; null when it has none. */
export function stepText(raw: string): string | null {
	const parsed = safeParseJsonObject(raw) as { text?: unknown } | null;
	const text = typeof parsed?.text === "string" ? parsed.text.trim() : "";
	return text ? text.slice(0, 280) : null;
}

/** A stored event's kind and, for an agent step, its text as the thread list shows it. */
export function eventShape(raw: string): { kind: string; text?: string } {
	const parsed = safeParseJsonObject(raw) as { kind?: unknown } | null;
	const kind = typeof parsed?.kind === "string" ? parsed.kind : "";
	const text = kind === "agent_step" ? stepText(raw) : null;
	return text ? { kind, text } : { kind };
}
