// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type CanonicalEvent, prHostTerms } from "@prismalens/contracts";
import { useNavigate } from "@tanstack/react-router";
import { GitPullRequest } from "lucide-react";
import {
	PR_TONE_WORD,
	prMarkClass,
} from "@/components/thread/panel/PullRequests";
import { cn } from "@/lib/utils";
import type { TranscriptNodeProps } from "./types";

type PrStatus = Extract<CanonicalEvent, { kind: "pr_status" }>;

/**
 * A pushed PR status (#1101 category 15 item 5): one quiet line with the panel's
 * tone mark; the PR number opens its panel row. Older records carry no tone.
 */
export function PrStatusNode({ event }: TranscriptNodeProps) {
	const e = event as PrStatus;
	const number = e.pr.split("#").pop() ?? e.pr;
	const tone = e.tone ?? "unknown";
	const terms = prHostTerms(e.host);
	const navigate = useNavigate();
	return (
		<p
			className="flex min-w-0 items-baseline gap-1.5 text-meta text-text-2"
			data-testid="pr-status-line"
			data-tone={tone}
		>
			<GitPullRequest
				className={cn("size-3.5 shrink-0 self-center", prMarkClass(tone))}
				aria-hidden
			/>
			<button
				type="button"
				onClick={() =>
					void navigate({
						to: ".",
						search: (s: Record<string, unknown>) => ({
							...s,
							panel: "thread" as const,
							section: `pull-requests:${e.prId}`,
						}),
					})
				}
				className="shrink-0 text-text-1 tabular-nums hover:underline"
			>
				{terms.short} {terms.numberPrefix}
				{number}
			</button>
			{e.tone && <span className="shrink-0">{PR_TONE_WORD[e.tone]}</span>}
			<span className="min-w-0 truncate">{e.lines.join(" · ")}</span>
		</p>
	);
}
