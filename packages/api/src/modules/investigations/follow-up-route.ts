// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type AccessLevel,
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessId,
} from "@prismalens/config/harness";
import type { HarnessSelection } from "@prismalens/config/harness-selection";
import type { FollowUpRoute, HarnessProbeOutcome } from "@prismalens/contracts";

/**
 * Where a finished run's follow-up goes: the run's own session when the same
 * agent can load it, else a fresh session of the chosen agent seeded by a
 * handoff. Null when the run names no agent and none was chosen.
 */
export function followUpRoute(
	inv: { harness: string | null; acpSessionId: string | null },
	chosen?: HarnessId,
): { route: FollowUpRoute; harness: HarnessId } | null {
	const own = HARNESS_IDS.find((h) => h === inv.harness);
	const harness = chosen ?? own;
	if (!harness) return null;
	const loads =
		harness === own && !!inv.acpSessionId && HARNESS_REGISTRY[harness].resume;
	return { route: loads ? "load" : "handoff", harness };
}

/** What stops the recipient taking the handoff, and the fix; null when it can. */
export function handoffPreflight(
	harness: HarnessId,
	selection: HarnessSelection,
	checked: HarnessProbeOutcome | null,
): { problem: string; fix: string } | null {
	const row = HARNESS_REGISTRY[harness];
	if (!selection.runnable)
		return {
			problem: selection.reason,
			fix:
				selection.failure === "model-unsupported"
					? "Pick another model on the model chip."
					: selection.failure === "env-pinned-other"
						? "Unset PRISMALENS_HARNESS, or pick the agent it names."
						: `Install it (${row.install}), or pick another agent.`,
		};
	if (checked === "sign-in-needed")
		return {
			problem: `${row.label} is not signed in.`,
			fix: `Sign in: ${row.loginHint}.`,
		};
	return null;
}

/** A handoff keeps the run's level; a run from before levels gets the narrowest. */
export function inheritedLevel(level: AccessLevel | undefined): AccessLevel {
	return level ?? "supervised";
}
