// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { stopNodeLine } from "@/lib/provider-stop";
import type { TranscriptNodeProps, TranscriptNodes } from "./types";

/** A provider stop, a retry, a resume or a restart, one quiet line (#1024, #1101). */
function StopNode({ event }: TranscriptNodeProps) {
	const line = stopNodeLine(event);
	if (!line) return null;
	return (
		<div
			className="flex items-center gap-2 py-1 text-meta text-text-3"
			data-testid={`node-${event.kind}`}
		>
			<span aria-hidden className="h-px w-3 shrink-0 bg-hairline" />
			<span className="min-w-0 [overflow-wrap:anywhere]">{line}</span>
		</div>
	);
}

const stop = { Node: StopNode };

/** UI 3's transcript nodes (#1024, #1101). Only UI 3 edits this file. */
export const appNodes = {
	usage_limit: stop,
	provider_blocked: stop,
	provider_retry: stop,
	resume_scheduled: stop,
	resumed: stop,
	run_interrupted: stop,
} satisfies TranscriptNodes;
