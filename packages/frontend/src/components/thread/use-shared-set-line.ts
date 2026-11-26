// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import type { SharedRevisionEvent } from "@prismalens/contracts/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export type Agent = HarnessId | string | null | undefined;

export const keepsSystemPrompt = (harness: Agent): harness is HarnessId =>
	!!harness &&
	Object.hasOwn(HARNESS_REGISTRY, harness) &&
	HARNESS_REGISTRY[harness as HarnessId].facts?.systemPromptVia?.value ===
		"claude-meta";

/**
 * The composer's compaction line (#1180 §3.3). Its logic and the set's read load only for an
 * agent that keeps its first system prompt, so the thread's first paint carries none (#1130).
 */
export function useSharedSetLine(
	events: readonly SharedRevisionEvent[],
	harness: Agent,
) {
	const keeps = keepsSystemPrompt(harness);
	const client = useQueryClient();
	const [line, setLine] = useState<{ line: string; detail: string } | null>(
		null,
	);
	useEffect(() => {
		if (!keeps) return setLine(null);
		let live = true;
		void import("./shared-set-line")
			.then((m) => m.sharedSetLineFor(client, events, harness))
			.then((l) => live && setLine(l))
			.catch(() => live && setLine(null));
		return () => {
			live = false;
		};
	}, [keeps, client, events, harness]);
	return line;
}
