// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { PR_EVENT_KIND_WORDS, type PrEventKind } from "@prismalens/contracts";
import {
	BellOff,
	CheckCheck,
	CircleDot,
	Eye,
	GitCommitHorizontal,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	ListChecks,
	type LucideIcon,
	MessageSquare,
	MessageSquareCode,
	MessageSquareDot,
	SquareArrowOutUpRight,
	TriangleAlert,
} from "lucide-react";
import type { InboundRow } from "@/lib/inbound-rows";

const KIND_ICON: Record<PrEventKind, LucideIcon> = {
	comment: MessageSquare,
	review: Eye,
	review_comment: MessageSquareCode,
	thread_resolved: CheckCheck,
	thread_reopened: MessageSquareDot,
	check: CircleDot,
	checks_done: ListChecks,
	push: GitCommitHorizontal,
	merged: GitMerge,
	closed: GitPullRequestClosed,
	reopened: GitPullRequest,
	conflict: TriangleAlert,
	subscription_ended: BellOff,
	legacy: Eye,
};

/** A PR bundle's provenance (#1179 §7): each item's kind, id, author and link; never its text. */
export function InboundPrEvents({
	prs,
}: {
	prs: NonNullable<InboundRow["prEvents"]>;
}) {
	return (
		<ul
			className="ml-[22px] flex min-w-0 flex-col"
			data-testid="inbound-pr-events"
		>
			{prs.flatMap((p) => [
				...p.items.map((i) => {
					const Icon = KIND_ICON[i.kind];
					return (
						<li
							key={`${p.prId}-${i.id}`}
							className="flex min-w-0 items-center gap-1.5 text-meta text-text-3"
						>
							<Icon aria-hidden className="size-3 shrink-0" />
							<span className="font-mono">[d{i.id}]</span>
							<span className="min-w-0 truncate text-text-2">
								{PR_EVENT_KIND_WORDS[i.kind]}
								{i.author && ` @${i.author}`}
								{i.association && `, ${i.association.toLowerCase()}`}
								{i.agentPosted && ", agent-posted"}
							</span>
							{i.link && (
								<a
									href={i.link}
									target="_blank"
									rel="noreferrer"
									aria-label="Open on the code host"
									className="shrink-0 hover:text-text-1"
								>
									<SquareArrowOutUpRight aria-hidden className="size-3" />
								</a>
							)}
						</li>
					);
				}),
				...(p.more.length
					? [
							<li key={`${p.prId}-more`} className="text-meta text-text-3">
								and {p.more.length} more
							</li>,
						]
					: []),
				...(p.superseded
					? [
							<li key={`${p.prId}-dropped`} className="text-meta text-text-3">
								{p.superseded} dropped (newer push)
							</li>,
						]
					: []),
			])}
		</ul>
	);
}
