// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ACCESS_LEVELS,
	type AccessLevel,
	DEFAULT_ACCESS_LEVEL,
	type HarnessId,
	NO_MODE_KEY,
	resolveAccess,
} from "@prismalens/config/harness";
import {
	ACCESS_LEVEL_LABEL,
	type AxisSource,
	type HarnessStatus,
	NO_SANDBOX,
	type SandboxCheck,
} from "@prismalens/contracts";
import { agentFacts } from "@/lib/agent-facts";

/** A stored level when PrismaLens knows it, else null; a list check, so no schema loads (#1130). */
export function knownAccessLevel(v: unknown): AccessLevel | null {
	return (ACCESS_LEVELS as readonly unknown[]).includes(v)
		? (v as AccessLevel)
		: null;
}

/** A lock only where the readiness check saw the agent's own sandbox hold the mode, never by its name (#673 w51). */
export function levelIcon(sandbox?: SandboxCheck | null): "lock" | null {
	return sandbox?.state === "enforced" ? "lock" : null;
}

/** What the last check said of this mode's sandbox, in one line. */
export function sandboxLine(sandbox?: SandboxCheck | null): string {
	if (!sandbox) return "Sandbox not checked yet.";
	if (sandbox.state === "enforced") return `Sandboxed: ${sandbox.reason}.`;
	if (sandbox.state === "none") return NO_SANDBOX;
	return `Sandbox unknown: ${sandbox.reason}.`;
}

/** The tag on the level a run takes when none is picked: where it came from (#673 w21), never the word Default (#907). */
export function levelTag(from: AxisSource): string {
	if (from === "agent") return "From your settings file";
	if (from === "prismalens") return "PrismaLens's pick";
	return "Set in Settings";
}

const harnessId = (h: HarnessStatus): HarnessId => h.id as HarnessId;

/** The agent mode a run at `level` asks for; `agent-default` where none. */
export function levelModeId(h: HarnessStatus, level: AccessLevel): string {
	return resolveAccess(harnessId(h), level).mode ?? NO_MODE_KEY;
}

/** The sandbox check for the mode a run at `level` runs. */
export function levelSandbox(
	h: HarnessStatus | undefined,
	level: AccessLevel,
): SandboxCheck | undefined {
	if (!h) return undefined;
	return h.checked?.sandbox?.[levelModeId(h, level)];
}

/** The row line under a level: what this agent runs at it. */
export function levelRowLine(h: HarnessStatus, level: AccessLevel): string {
	return resolveAccess(harnessId(h), level).line(
		h.checked ? { modes: h.checked.modes } : null,
	);
}

/** The Settings line under Permission: set here, the agent's own settings file, or PrismaLens's pick (#673 w21). */
export function permissionLine(
	h: HarnessStatus,
	set: AccessLevel | undefined,
): string {
	if (set) return `${ACCESS_LEVEL_LABEL[set]}, set here.`;
	const fallback = `${ACCESS_LEVEL_LABEL[DEFAULT_ACCESS_LEVEL]}, PrismaLens's pick.`;
	const facts = agentFacts(h.id);
	if (facts?.modeMechanism === "none")
		return `${fallback} ${h.label} has no modes.`;
	if (facts?.noLevelReason) return `${fallback} ${facts.noLevelReason}`;
	const local = h.localDefault?.permission;
	if (!local)
		return `${fallback} No level set in ${facts?.settingsFile ?? "its settings"}.`;
	if (local.level)
		return `${ACCESS_LEVEL_LABEL[local.level]}, from ${local.file} ("${local.value}").`;
	if (local.reason)
		return `${fallback} ${local.reason}, so "${local.value}" cannot apply.`;
	return `${fallback} Your ${h.label} setting "${local.value}" in ${local.file} has no PrismaLens Permission.`;
}

/** What each agent's own settings still decide, under the Settings rows (#673 w21). */
export function agentNote(h: HarnessStatus): string | null {
	const note = agentFacts(h.id)?.ownSettingsNote;
	return note ? note(h.checked ? { modes: h.checked.modes } : null) : null;
}
