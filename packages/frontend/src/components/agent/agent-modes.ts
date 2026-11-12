// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ACCESS_LEVELS,
	type AccessLevel,
	HARNESS_REGISTRY,
	type HarnessId,
} from "@prismalens/config/harness";
import type { HarnessStatus } from "@prismalens/contracts";

/** One of the agent's own permission modes, as its last check listed it (sheet §5, #1101). */
export interface AgentMode {
	id: string;
	name: string;
	description?: string;
}

/** The agent's own modes; null when it lists none and the levels stand in. */
export function agentModes(h: HarnessStatus | undefined): AgentMode[] | null {
	const modes = h?.checked?.modes;
	return modes?.length ? modes : null;
}

const accessOf = (h: HarnessStatus) =>
	HARNESS_REGISTRY[h.id as HarnessId]?.access;

/**
 * The level that runs `mode`: `keep` when it already does (OpenCode runs every
 * level in `build`), then one whose own mode it is, then one that falls back
 * to it. Null when no level does; the run then sets the mode as is.
 */
export function levelOfMode(
	h: HarnessStatus | undefined,
	mode: string,
	keep?: AccessLevel,
): AccessLevel | null {
	const access = h && accessOf(h);
	if (!access) return null;
	if (keep && modeOfLevel(h, keep) === mode) return keep;
	return (
		ACCESS_LEVELS.find((l) => access[l].mode === mode) ??
		ACCESS_LEVELS.find((l) => access[l].fallbackMode === mode) ??
		null
	);
}

/** The mode a run at `level` ends up in: its own if offered, else its fallback. */
export function modeOfLevel(
	h: HarnessStatus | undefined,
	level: AccessLevel,
): string | null {
	const access = h && accessOf(h)?.[level];
	if (!access?.mode) return null;
	const offered = agentModes(h);
	if (!offered) return access.mode;
	const has = (id: string | undefined) =>
		!!id && offered.some((m) => m.id === id);
	if (has(access.mode)) return access.mode;
	return has(access.fallbackMode) ? (access.fallbackMode ?? null) : null;
}

/** What the box will ask for: the picked mode, or the level's. */
export function chosenMode(
	h: HarnessStatus | undefined,
	level: AccessLevel,
	agentMode: string | null | undefined,
): string | null {
	return agentMode || modeOfLevel(h, level);
}
