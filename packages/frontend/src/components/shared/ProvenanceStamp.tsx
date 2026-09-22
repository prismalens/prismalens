// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { cn } from "@/lib/utils";

export interface ProvenanceStampProps {
	/** When the value was captured. ISO string or Date. */
	capturedAt: string | Date;
	/** The event kind that carried it, e.g. `tool_result`. */
	source?: string;
	/** The tool or query that produced it, e.g. `fetch_logs`. */
	via?: string;
	className?: string;
}

function hhmmZ(d: Date): string {
	return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
}

/**
 * Worn by every number inside the record. Record numbers are quotes from the run;
 * the stamp says when and how the quote was taken, so a reopened record stays legible.
 */
export function ProvenanceStamp({
	capturedAt,
	source,
	via,
	className,
}: ProvenanceStampProps) {
	const date = new Date(capturedAt);
	const iso = Number.isNaN(date.getTime())
		? String(capturedAt)
		: date.toISOString();
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 font-mono text-meta text-muted-foreground tabular-nums",
				className,
			)}
		>
			<span>captured</span>
			<time dateTime={iso} title={iso}>
				{Number.isNaN(date.getTime()) ? String(capturedAt) : hhmmZ(date)}
			</time>
			{source && <span>· {source}</span>}
			{via && <span>· {via}</span>}
		</span>
	);
}
