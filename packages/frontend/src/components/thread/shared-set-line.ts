// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HARNESS_REGISTRY } from "@prismalens/config/harness";
import {
	heldSharedRevision,
	type SharedRevisionEvent,
	type SharedSet,
} from "@prismalens/contracts/schemas";
import type { QueryClient } from "@tanstack/react-query";
import { orpc } from "@/lib/api/orpc-client";
import { type Agent, keepsSystemPrompt } from "./use-shared-set-line";

export const SHARED_SET_COMPACT_LINE =
	"Changed instructions reach this thread after it compacts.";

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

/** The line once the set is read: from the cache Settings keeps, else fetched once. */
export async function sharedSetLineFor(
	client: QueryClient,
	events: readonly SharedRevisionEvent[],
	harness: Agent,
): Promise<{ line: string; detail: string } | null> {
	const set = await client.ensureQueryData(
		orpc.settings.agentSetup.sharedSet.queryOptions({ input: {} }),
	);
	return sharedSetLine(events, harness, set);
}
