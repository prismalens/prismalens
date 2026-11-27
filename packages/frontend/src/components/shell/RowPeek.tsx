// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	agentName,
	lastPlainLine,
	type ThreadRow,
} from "@prismalens/contracts";
import { AgentMark } from "@/components/agent/AgentMark";
import { fact } from "@/components/kit/fact";
import {
	BranchMark,
	StartedByMark,
	startedByLabel,
} from "@/components/kit/MarkBadges";
import { markLook } from "@/components/kit/marks";
import { statusWord } from "@/components/kit/Status";
import { prLabel, RowPlace } from "@/components/shell/RowLines";
import { StatusMark, wordTone } from "@/components/shell/ThreadTree";
import { GitStateMark } from "@/components/thread/git/GitStateMark";
import type { ListNode } from "@/lib/thread-list";
import { statusReason } from "@/lib/thread-status";
import { cn } from "@/lib/utils";

/** A thread's PRs, newest first, as the row's PR badge and its card list them (#1020). */
export function PrList({ pr }: { pr: NonNullable<ThreadRow["pr"]> }) {
	const stack = pr.stack ?? [
		{ number: pr.number, tone: pr.tone, title: pr.title ?? null },
	];
	const rest = (pr.count ?? stack.length) - stack.length;
	return (
		<ul
			aria-label={prLabel(pr)}
			className="flex flex-col gap-1 text-meta"
			data-testid="peek-prs"
			{...fact("pr")}
		>
			{stack.map((p) => {
				const look = markLook("changeRequest", p.tone);
				return (
					<li key={p.number} className="flex min-w-0 items-center gap-1.5">
						<look.icon
							aria-label={look.word ?? p.tone}
							className={cn("size-3 shrink-0", look.className)}
						/>
						<span className="text-text-1 tabular-nums">#{p.number}</span>
						<span className="min-w-0 truncate text-text-2">
							{p.title ?? ""}
						</span>
					</li>
				);
			})}
			{rest > 0 && <li className="text-text-3">{rest} more</li>}
		</ul>
	);
}

/**
 * The card a rest on the row opens, and Space: what holds the thread, where it runs, and
 * every badge in words. Resting on the PR badge shows only the PR list.
 */
export function Peek({
	node,
	now,
	title,
	more,
	only,
}: {
	node: ListNode;
	now: number;
	title: string;
	/** An ask row's wait and why it asked. */
	more?: string | null;
	only?: "prs";
}) {
	const t = node.thread;
	if (only === "prs" && t.pr) return <PrList pr={t.pr} />;
	const reason = statusReason(t, node.info, now);
	const commits = t.commits ?? 0;
	const alerts = node.unit.incident?.alertCount ?? 0;
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
			{more && (
				<p className="text-meta text-text-3" data-testid="peek-ask-more">
					{more}
				</p>
			)}
			{(t.serviceName || t.projectName) && <RowPlace t={t} />}
			{t.harness && (
				<p
					className="flex items-center gap-1.5 text-meta text-text-2"
					data-testid="peek-agent"
					{...fact("agent")}
				>
					<AgentMark id={t.harness} className="size-3.5" />
					<span className="min-w-0 truncate">
						{agentName(t.harness)}
						{t.model ? ` · ${t.model}` : ""}
					</span>
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
			{(commits > 0 || !!alerts) && (
				<p
					className="text-meta text-text-2 tabular-nums"
					data-testid="peek-counts"
				>
					{[
						commits > 0 && `${commits} ${commits === 1 ? "commit" : "commits"}`,
						!!alerts && `${alerts} ${alerts === 1 ? "alert" : "alerts"}`,
					]
						.filter(Boolean)
						.join(" · ")}
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
			{t.pr && <PrList pr={t.pr} />}
		</div>
	);
}
