// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	HARNESS_REGISTRY,
	type HarnessDescriptor,
	type HarnessId,
} from "@prismalens/config/harness";

/**
 * What the agent registry says of an agent, by the id a status carries. Every
 * per-agent difference the UI draws reads from here, never from `id === "…"`.
 */
export function agentFacts(
	id: string | null | undefined,
): HarnessDescriptor | undefined {
	return id ? HARNESS_REGISTRY[id as HarnessId] : undefined;
}
