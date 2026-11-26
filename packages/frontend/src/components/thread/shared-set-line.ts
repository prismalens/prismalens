// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import {
	heldSharedRevision,
	type SharedRevisionEvent,
	type SharedSet,
} from "@prismalens/contracts/schemas";
import { useMemo } from "react";
import { useSharedSet } from "@/lib/api/hooks/use-agent-setup-orpc";

export const SHARED_SET_COMPACT_LINE =
	"Changed instructions reach this thread after it compacts.";

type Agent = HarnessId | string | null | undefined;

const keepsSystemPrompt = (harness: Agent): harness is HarnessId =>
	!!harness &&
	Object.hasOwn(HARNESS_REGISTRY, harness) &&
	HARNESS_REGISTRY[harness as HarnessId].facts?.systemPromptVia?.value ===
		"claude-meta";

/**
 * The composer line for a thread whose session holds other PrismaLens instructions than the
 * set's now; only for an agent that keeps its first system prompt until it compacts (#1180 §3.3).
 */
export function sharedSetLine(
	events: readonly SharedRevisionEvent[],
	harness: Agent,
	set: SharedSet | undefined,
): { line: string; detail: string } | null {
	if (!set || !keepsSystemPrompt(harness)) return null;
	const held = heldSharedRevision(events);
	if (held === null) return null;
	const want =
		set.instructionsFor.includes(harness) && set.instructions.trim()
			? set.revision
			: "";
	if (held === want) return null;
	return {
		line: SHARED_SET_COMPACT_LINE,
		detail: `${HARNESS_REGISTRY[harness].label} keeps the instructions its conversation started with until it compacts.`,
	};
}

export function useSharedSetLine(
	events: readonly SharedRevisionEvent[],
	harness: Agent,
) {
	const set = useSharedSet(keepsSystemPrompt(harness)).data;
	return useMemo(
		() => sharedSetLine(events, harness, set),
		[events, harness, set],
	);
}
