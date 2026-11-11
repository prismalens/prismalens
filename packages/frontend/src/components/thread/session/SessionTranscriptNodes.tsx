// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { TranscriptNodeProps } from "@/components/investigation/transcript/types";
import { useCompactSession } from "@/lib/api/hooks/use-session-orpc";
import { CompactionNode, LimitNode } from "./SessionNodes";

/** A compaction event; Retry compacts again with the same focus. */
export function CompactionEventNode({ event, runId }: TranscriptNodeProps) {
	const compact = useCompactSession(runId ?? "");
	if (event.kind !== "compaction") return null;
	return (
		<CompactionNode
			event={event}
			onRetry={runId ? () => compact.mutate(event.instructions) : undefined}
		/>
	);
}

/** `usage_limit`, `resume_scheduled` and `resumed`, one line each. */
export function LimitEventNode({ event }: TranscriptNodeProps) {
	if (
		event.kind !== "usage_limit" &&
		event.kind !== "resume_scheduled" &&
		event.kind !== "resumed"
	)
		return null;
	return <LimitNode event={event} />;
}
