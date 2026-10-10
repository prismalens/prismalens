// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type AccessLevel,
	DEFAULT_ACCESS_LEVEL,
	DEFAULT_RUN_MODE,
	HARNESS_REGISTRY,
	type HarnessId,
	NO_MODE_KEY,
	planModeId,
	planReplacesLevel,
	type RunMode,
	resolveAccess,
} from "@prismalens/config/harness";
import {
	ACCESS_LEVEL_LABEL,
	type AxisSource,
	type HarnessStatus,
	NO_SANDBOX,
	RUN_MODE_LABEL,
	type SandboxCheck,
} from "@prismalens/contracts";

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

/** The tag on the default row: where the default came from (#673 w21). */
export function defaultTag(from: AxisSource): string {
	if (from === "agent") return "Your default";
	if (from === "prismalens") return "PrismaLens default";
	return "From Settings";
}

const harnessId = (h: HarnessStatus): HarnessId => h.id as HarnessId;

/** Plan takes the level's slot on this agent: in Plan no level applies. */
export function planIsCoupled(h: HarnessStatus | undefined): boolean {
	return !!h && planReplacesLevel(harnessId(h));
}

/** The agent mode a run at `level` in `runMode` asks for; `agent-default` where none. */
export function runModeId(
	h: HarnessStatus,
	level: AccessLevel,
	runMode: RunMode,
): string {
	const id = harnessId(h);
	const plan = runMode === "plan" ? planModeId(id) : null;
	return plan ?? resolveAccess(id, level).mode ?? NO_MODE_KEY;
}

/** The sandbox check for the mode a run at `level` in `runMode` runs. */
export function levelSandbox(
	h: HarnessStatus | undefined,
	level: AccessLevel,
	runMode: RunMode = "execute",
): SandboxCheck | undefined {
	if (!h) return undefined;
	return h.checked?.sandbox?.[runModeId(h, level, runMode)];
}

/** The row line under a level: what this agent runs at it. */
export function levelRowLine(h: HarnessStatus, level: AccessLevel): string {
	return resolveAccess(harnessId(h), level).line(
		h.checked ? { modes: h.checked.modes } : null,
	);
}

/** The chip's words: the level in Execute; Plan, and the level where Plan keeps one. */
export function accessChipText(
	h: HarnessStatus | undefined,
	level: AccessLevel,
	runMode: RunMode,
): string {
	if (runMode === "execute") return ACCESS_LEVEL_LABEL[level];
	return planIsCoupled(h)
		? RUN_MODE_LABEL.plan
		: `${RUN_MODE_LABEL.plan}, ${ACCESS_LEVEL_LABEL[level]}`;
}

/** The file PrismaLens reads each agent's default from, as a line names it when nothing is set there. */
const DEFAULT_FILE: Partial<Record<HarnessId, string>> = {
	"claude-code": "~/.claude/settings.json",
	codex: "~/.codex/config.toml",
	gemini: "~/.gemini/settings.json",
	opencode: "~/.config/opencode/opencode.json",
};

/** The Settings line under Permission: set here, the agent's own default, or PrismaLens's (#673 w21). */
export function permissionLine(
	h: HarnessStatus,
	set: AccessLevel | undefined,
): string {
	if (set) return `${ACCESS_LEVEL_LABEL[set]}, set here.`;
	const fallback = `${ACCESS_LEVEL_LABEL[DEFAULT_ACCESS_LEVEL]}, PrismaLens default.`;
	const id = harnessId(h);
	if (id === "deepagents") return `${fallback} deepagents has no modes.`;
	if (id === "opencode")
		return `${fallback} OpenCode has per-tool rules, not one permission level.`;
	const local = h.localDefault?.permission;
	if (!local)
		return `${fallback} No default set in ${DEFAULT_FILE[id] ?? "its settings"}.`;
	if (local.level)
		return `Your default: ${ACCESS_LEVEL_LABEL[local.level]}, from ${local.file} ("${local.value}").`;
	if (local.reason)
		return `${fallback} ${local.reason}, so "${local.value}" cannot apply.`;
	return `${fallback} Your ${h.label} default "${local.value}" in ${local.file} has no PrismaLens Permission.`;
}

/** The Settings line under Mode. */
export function modeLine(h: HarnessStatus, set: RunMode | undefined): string {
	if (set) return `${RUN_MODE_LABEL[set]}, set here.`;
	const fallback = `${RUN_MODE_LABEL[DEFAULT_RUN_MODE]}, PrismaLens default.`;
	const id = harnessId(h);
	if (id === "deepagents") return `${fallback} deepagents has no modes.`;
	const local = h.localDefault?.mode;
	if (!local)
		return id === "codex"
			? fallback
			: `${fallback} No default set in ${DEFAULT_FILE[id] ?? "its settings"}.`;
	if (local.mode)
		return `Your default: ${RUN_MODE_LABEL[local.mode]}, from ${local.file} ("${local.value}").`;
	return `${fallback} Your ${h.label} default "${local.value}" in ${local.file} has no PrismaLens Mode.`;
}

/** What each agent's own settings still decide, under the Settings rows (#673 w21). */
export function agentNote(h: HarnessStatus): string | null {
	switch (harnessId(h)) {
		case "claude-code":
			return "Your ~/.claude/settings.json allow and deny rules, hooks and sandbox apply, as in your terminal. The terminal's own default may be Auto on Claude Code 2.1.228 and later; PrismaLens reads the key, not that default.";
		case "codex":
			return h.checked?.modes &&
				!h.checked.modes.some((m) => m.id === "workspace-write")
				? "This codex-acp runs Ask always and Auto-accept edits in the same mode, Ask for approval; edits inside the copy need no ask."
				: null;
		case "opencode":
			return "Your opencode.json rules stay; PrismaLens sets each tool's catch-all for the level.";
		case "gemini":
			return "Gemini CLI runs the copy untrusted, so it offers Ask always and Plan here; the other levels run as Ask always.";
		default:
			return null;
	}
}

/** Whether the agent offers a plan mode, by its last check; false until a check said so. */
export function offersPlan(h: HarnessStatus | undefined): boolean {
	return (
		!!h &&
		!!HARNESS_REGISTRY[harnessId(h)]?.planMode &&
		h.checked?.plan === true
	);
}
