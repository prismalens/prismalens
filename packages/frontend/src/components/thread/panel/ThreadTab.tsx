// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	HarnessStatus,
	ThreadContext,
	ThreadSession,
} from "@prismalens/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ListFilter } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Hint } from "@/components/shared/Hint";
import { Loading, Problem } from "@/components/shared/State";
import { usePanelPullRequests } from "@/lib/api/hooks/use-thread-pull-requests";
import {
	useRevokeTreeAllowance,
	useThreadLinks,
} from "@/lib/api/hooks/use-thread-tree-orpc";
import { PanelStack } from "./PanelStack";
import { PullRequestList, type PullRequestView } from "./PullRequests";
import {
	PanelSection,
	PlanSection,
	SessionSection,
	StartedSection,
	startedHeading,
} from "./ThreadSections";
import { startedCount } from "./thread-details";

/**
 * The Details tab (#1024): pull requests, what the thread started, the plan, steps and
 * its session, each absent when empty. `section` scrolls one into view.
 */
export function ThreadTab({
	threadId,
	context,
	contextFailed = false,
	onRetryContext,
	harness,
	live,
	session,
	steps,
	section,
	focusPr,
	onOpenPr,
	onOpenSubagent,
}: {
	threadId: string;
	context: ThreadContext | undefined;
	/** The context read failed; Retry reads it again. */
	contextFailed?: boolean;
	onRetryContext?: () => void;
	/** The thread's agent, for its name and its models' names. */
	harness?: HarnessStatus | undefined;
	live: boolean;
	session?: ThreadSession;
	/** The run's steps, filtered and timestamped; absent when it ran none. */
	steps?: ReactNode;
	section?: string;
	focusPr?: string;
	/** Opens one PR's view in the panel (sheet §4). */
	onOpenPr: (prId: string) => void;
	/** Opens one sub-agent's pane from its stored summary (#1176 D16). */
	onOpenSubagent?: (sessionId: string) => void;
}) {
	const links = useThreadLinks(threadId, live);
	const navigate = useNavigate();
	const revoke = useRevokeTreeAllowance();
	const pulls = usePanelPullRequests(
		threadId,
		(context?.pullRequests.length ?? 0) > 0,
	);
	useEffect(() => {
		if (!section) return;
		document
			.getElementById(`panel-section-${section}`)
			?.scrollIntoView({ block: "start" });
	}, [section]);
	if (!context)
		return contextFailed ? (
			<div className="px-2" data-testid="details-failed">
				<Problem text="Details didn't load" onRetry={onRetryContext} />
			</div>
		) : (
			<Loading rows={3} />
		);
	const prs = (pulls.data?.pullRequests ??
		context.pullRequests) as PullRequestView[];
	const l = links.data;
	const hasLinks =
		!!l &&
		(!!l.startedBy ||
			l.started.length > 0 ||
			(l.subagents?.length ?? 0) > 0 ||
			!!l.allowance);
	const filter = () =>
		void navigate({
			to: ".",
			search: (prev: Record<string, unknown>) => ({ ...prev, by: threadId }),
		} as never);
	return (
		<PanelStack>
			{prs.length > 0 && (
				<PanelSection id="pull-requests" title="Pull requests">
					<PullRequestList prs={prs} focusId={focusPr} onOpen={onOpenPr} />
				</PanelSection>
			)}
			{links.isError && !l && (
				<PanelSection id="threads" title="Started">
					<div className="px-2" data-testid="threads-failed">
						<Problem
							text="Threads didn't load"
							onRetry={() => void links.refetch()}
						/>
					</div>
				</PanelSection>
			)}
			{l && hasLinks && (
				<PanelSection
					id="threads"
					title={startedHeading(startedCount(l).running)}
					aside={
						l.started.length > 0 && (
							<Hint label="Show only these in the list">
								<button
									type="button"
									aria-label="Show only these in the list"
									onClick={filter}
									className="flex size-5 shrink-0 items-center justify-center self-center rounded-control text-text-3 hover:bg-surface-3 hover:text-text-1"
									data-testid="details-started-filter"
								>
									<ListFilter aria-hidden className="size-3.5" />
								</button>
							</Hint>
						)
					}
				>
					<StartedSection
						links={l}
						isHost={context.machine.isHost}
						harness={context.agent.harness}
						onRevoke={() => revoke.mutate({ id: threadId })}
						{...(onOpenSubagent ? { onOpenSubagent } : {})}
					/>
				</PanelSection>
			)}
			{context.plan && context.plan.length > 0 && (
				<PanelSection id="plan" title="Plan">
					<PlanSection plan={context.plan} />
				</PanelSection>
			)}
			{steps && (
				<PanelSection id="steps" title="Steps">
					{steps}
				</PanelSection>
			)}
			<PanelSection id="machine" title="Session">
				<SessionSection context={context} session={session} harness={harness} />
			</PanelSection>
		</PanelStack>
	);
}

export { prAnswersOf } from "./pr-answers";
