// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).
import { HARNESS_IDS, HARNESS_REGISTRY } from "@prismalens/config/harness";
import type { FailureMode } from "./provider-failure.js";

/** Stops that need the user: no timer, no retry, and the words never say "resumes". */
export const BLOCKED_MODES = [
	"out_of_credit",
	"key_rejected",
	"spend_cap",
] as const satisfies readonly FailureMode[];
export type BlockedMode = (typeof BLOCKED_MODES)[number];

export function isBlockedMode(
	mode: string | null | undefined,
): mode is BlockedMode {
	return (BLOCKED_MODES as readonly string[]).includes(mode ?? "");
}

/** An agent's display name from the registry, whether a record stored its id or a label in any case. */
export function agentName(stored: string): string {
	const s = stored.trim();
	const id = HARNESS_IDS.find(
		(i) =>
			i === s.toLowerCase().replace(/[\s_]+/g, "-") ||
			HARNESS_REGISTRY[i].label.toLowerCase() === s.toLowerCase(),
	);
	return id
		? HARNESS_REGISTRY[id].label
		: s.charAt(0).toUpperCase() + s.slice(1);
}
