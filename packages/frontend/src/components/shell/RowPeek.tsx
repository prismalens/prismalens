// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { lastPlainLine } from "@prismalens/contracts";
import { fact } from "@/components/kit/fact";
import {
	BranchMark,
	StartedByMark,
	startedByLabel,
} from "@/components/kit/MarkBadges";
import { statusWord } from "@/components/kit/Status";
import { StatusMark, wordTone } from "@/components/shell/ThreadTree";
import { GitStateMark } from "@/components/thread/git/GitStateMark";
import type { ListNode } from "@/lib/thread-list";
import { statusReason } from "@/lib/thread-status";
import { cn } from "@/lib/utils";

/** Space, or Answer on an ask row: the last agent sentence and what holds the thread. */
export function Peek({
	node,
	now,
	title,
}: {
	node: ListNode;
	now: number;
	title: string;
}) {
	const t = node.thread;
	const reason = statusReason(t, node.info, now);
	return (
		<div className="flex flex-col gap-1.5 text-body">
			<p className="truncate font-medium text-text-1">{title}</p>
			<p className="flex items-center gap-1.5 text-meta" {...fact("status")}>
				<StatusMark status={node.info.status} />
				<span className={cn("font-medium", wordTone(node.info.status))}>
					{statusWord(node.info.status)}
				</span>
			</p>
			{reason && (
				<p className="line-clamp-2 text-meta text-text-3" {...fact("cause")}>
					{reason}
				</p>
			)}
			{(t.git || t.branch) && (
				<p
					className="flex min-w-0 items-center gap-1.5 text-meta"
					data-testid="peek-branch"
				>
					{t.git && <GitStateMark git={t.git} />}
					{t.branch && <BranchMark branch={t.branch} />}
				</p>
			)}
			{t.startedBy && (
				<p className="flex items-center gap-1.5 text-meta text-text-2">
					<StartedByMark by={t.startedBy} />
					<span className="min-w-0 truncate">
						{startedByLabel(t.startedBy)}
					</span>
				</p>
			)}
			<p
				dir="auto"
				className="line-clamp-4 text-meta text-text-2"
				data-testid="peek-latest"
			>
				{lastPlainLine(t.latestText) ?? "No reply yet"}
			</p>
			{t.pr && (
				<p className="text-meta text-text-2">
					PR #{t.pr.number} {t.pr.tone}
				</p>
			)}
		</div>
	);
}
