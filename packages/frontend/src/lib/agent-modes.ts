// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * How a mode reads in PrismaLens, by the agent's own ACP mode id (#673 w21):
 * the agent sandboxes (`lock`), edits files (`pencil`) or asks for nothing PrismaLens can stop (`open`).
 */
export type ModeIcon = "lock" | "pencil" | "open";

const SANDBOXED = new Set(["plan", "read-only"]);
const EDITS = new Set(["acceptEdits", "agent", "auto"]);
/** Modes in which the agent never asks, so PrismaLens never answers for it. */
const NEVER_ASKS = new Set(["bypassPermissions", "agent-full-access", "plan"]);

export function modeIcon(id: string): ModeIcon {
	if (SANDBOXED.has(id)) return "lock";
	if (EDITS.has(id)) return "pencil";
	return "open";
}

export const YES_CLAUSE = "PrismaLens answers yes and logs it.";

/** The agent's own description, then the clause when the agent asks in this mode. */
export function modeLine(id: string, description?: string): string {
	const text = description?.trim() ?? "";
	const own = text ? text.replace(/\.?$/, ".") : "";
	if (NEVER_ASKS.has(id) || id === "agent-default") return own;
	return own ? `${own} ${YES_CLAUSE}` : YES_CLAUSE;
}
