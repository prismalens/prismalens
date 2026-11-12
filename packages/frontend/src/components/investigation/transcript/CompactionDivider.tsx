// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { CompactionNode } from "@/components/thread/session/SessionNodes";
import { useCompactSession } from "@/lib/api/hooks/use-session-orpc";
import type { TranscriptNodeProps } from "./types";

/**
 * A compaction as a divider across the transcript (#1101 cat 11): tokens before and
 * after, the focus it kept, and Retry when it failed.
 */
export function CompactionDivider({ event }: TranscriptNodeProps) {
	const e = event as Extract<CanonicalEvent, { kind: "compaction" }>;
	const compact = useCompactSession(e.runId);
	return (
		<div className="flex items-center gap-3" data-testid="compaction-divider">
			<span aria-hidden className="h-px flex-1 bg-hairline" />
			<CompactionNode
				event={e}
				onRetry={
					e.phase === "failed" && e.method !== "agent_auto"
						? () => compact.mutate(e.instructions)
						: undefined
				}
			/>
			<span aria-hidden className="h-px flex-1 bg-hairline" />
		</div>
	);
}
