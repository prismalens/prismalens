// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Pure, unit-testable rung planning for the ablation ladder (#220).
 */
import { HARNESS_REGISTRY } from "@prismalens/config/harness";
import type { ArmOptions } from "./ab-runner.js";

export type Rung = "L0" | "L1" | "L2" | "L3";

/**
 * The complete tool-denial list for L0.
 * Derived from the runner's tool universe (HARNESS_REGISTRY["claude-code"].readOnlyDeny
 * + Agent SDK built-in tool set), covering shell, file read/write, search, web, and subagent tools.
 */
export const DENY_ALL_TOOLS: string[] = Array.from(
	new Set([
		...(HARNESS_REGISTRY["claude-code"].readOnlyDeny ?? []),
		"Read",
		"Bash",
		"BashOutput",
		"KillShell",
		"NotebookEdit",
		"Glob",
		"Grep",
		"WebFetch",
		"WebSearch",
		"Task",
		"TodoWrite",
		"SlashCommand",
		"ExitPlanMode",
	]),
);

/**
 * Maps a rung + base options to the exact ArmOptions for that rung:
 * - L0: maxTurns = 1, no skillPluginPath, disallowedTools = DENY_ALL_TOOLS
 * - L1: no skillPluginPath (tools on, no skill)
 * - L2: skill on (domain knowledge = today's raw arm)
 * - L3: skill on (supervisor selection happens in entry point)
 */
export function rungArmOptions(rung: Rung, base: ArmOptions): ArmOptions {
	const { skillPluginPath, disallowedTools, maxTurns, ...rest } = base;

	switch (rung) {
		case "L0":
			return {
				...rest,
				maxTurns: 1,
				disallowedTools: [...DENY_ALL_TOOLS],
			};
		case "L1":
			return {
				...rest,
				...(maxTurns !== undefined ? { maxTurns } : {}),
			};
		case "L2":
		case "L3":
			return {
				...rest,
				...(skillPluginPath !== undefined ? { skillPluginPath } : {}),
				...(maxTurns !== undefined ? { maxTurns } : {}),
			};
	}
}
