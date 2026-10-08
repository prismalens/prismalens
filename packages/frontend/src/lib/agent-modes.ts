// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SandboxCheck } from "@prismalens/contracts";

/**
 * How a mode reads in PrismaLens, by the agent's own ACP mode id (#673 w21):
 * the agent's sandbox holds it here (`lock`), it edits files (`pencil`) or asks for nothing PrismaLens can stop (`open`).
 */
export type ModeIcon = "lock" | "pencil" | "open";

const EDITS = new Set(["acceptEdits", "agent", "auto"]);
/**
 * Modes in which the agent never asks: only codex-acp's `agent-full-access` (approval "never").
 * Claude's `bypassPermissions` still asks on safety checks and `plan` asks to leave the plan (#799).
 */
const NEVER_ASKS = new Set(["agent-full-access"]);

/** The lock only where the readiness check saw the agent's own sandbox hold the mode, never by mode name (#673 w51). */
export function modeIcon(id: string, sandbox?: SandboxCheck | null): ModeIcon {
	if (sandbox?.state === "enforced") return "lock";
	if (EDITS.has(id)) return "pencil";
	return "open";
}

export const YES_CLAUSE = "PrismaLens answers yes and logs it.";
export const NO_SANDBOX = "No sandbox: the agent's mode is the only limit.";

/** The agent's own description, then the clause when the agent asks in this mode. */
export function modeLine(id: string, description?: string): string {
	const text = description?.trim() ?? "";
	const own = text ? text.replace(/\.?$/, ".") : "";
	if (NEVER_ASKS.has(id) || id === "agent-default") return own;
	return own ? `${own} ${YES_CLAUSE}` : YES_CLAUSE;
}

/** What the last check said of this mode's sandbox, in one line. */
export function sandboxLine(sandbox?: SandboxCheck | null): string {
	if (!sandbox) return "Sandbox not checked yet.";
	if (sandbox.state === "enforced") return `Sandboxed: ${sandbox.reason}.`;
	if (sandbox.state === "none") return NO_SANDBOX;
	return `Sandbox unknown: ${sandbox.reason}.`;
}
