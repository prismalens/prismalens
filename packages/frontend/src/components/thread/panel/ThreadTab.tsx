// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadContext, ThreadSession } from "@prismalens/contracts";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { useAgentChoice } from "@/components/agent/AgentPicker";
import { Loading } from "@/components/shared/State";
import { usePanelPullRequests } from "@/lib/api/hooks/use-thread-pull-requests";
import {
	useRevokeTreeAllowance,
	useThreadLinks,
} from "@/lib/api/hooks/use-thread-tree-orpc";
import {
	type PrAnswers,
	PullRequestList,
	type PullRequestView,
} from "./PullRequests";
import {
	MachineAgentSection,
	PanelSection,
	PlanSection,
	ThreadLinksSection,
} from "./ThreadSections";
import { PanelStack } from "./ThreadSidePanel";

/**
 * The Thread tab (#1024): pull requests, the thread tree, the plan, steps and the
 * machine and agent, each absent when empty. `section` scrolls one into view.
 */
export function ThreadTab({
	threadId,
	context,
	live,
	session,
	steps,
	section,
	focusPr,
	onOpenPr,
}: {
	threadId: string;
	context: ThreadContext | undefined;
	live: boolean;
	session?: ThreadSession;
	/** The run's steps, filtered and timestamped; absent when it ran none. */
	steps?: ReactNode;
	section?: string;
	focusPr?: string;
	/** Opens one PR's view in the panel (sheet §4). */
	onOpenPr: (prId: string) => void;
}) {
	const links = useThreadLinks(threadId, live);
	const navigate = useNavigate();
	const revoke = useRevokeTreeAllowance();
	const { harnesses } = useAgentChoice();
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
	if (!context) return <Loading rows={3} />;
	const prs = (pulls.data?.pullRequests ??
		context.pullRequests) as PullRequestView[];
	const agentLabel =
		harnesses.find((h) => h.id === context.agent.harness)?.label ?? null;
	return (
		<PanelStack>
			{prs.length > 0 && (
				<PanelSection id="pull-requests" title="Pull requests">
					<PullRequestList prs={prs} focusId={focusPr} onOpen={onOpenPr} />
				</PanelSection>
			)}
			{links.data &&
				(links.data.startedBy ||
					links.data.started.length > 0 ||
					links.data.allowance) && (
					<PanelSection id="threads" title="Threads">
						<ThreadLinksSection
							links={links.data}
							isHost={context.machine.isHost}
							onRevoke={() => revoke.mutate({ id: threadId })}
							onFilter={() =>
								void navigate({
									to: ".",
									search: (prev: Record<string, unknown>) => ({
										...prev,
										by: threadId,
									}),
								} as never)
							}
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
			<PanelSection id="machine" title="Machine and agent">
				<MachineAgentSection
					context={context}
					agentLabel={agentLabel}
					live={live}
					session={session}
				/>
			</PanelSection>
		</PanelStack>
	);
}

/** What a PR answers, from the thread's incident and report (#1101 category 15 item 6). */
export function prAnswersOf(
	context: ThreadContext | undefined,
): PrAnswers | null {
	return context?.kind === "incident"
		? { incidentNumber: context.incident.number, cause: causeOf(context) }
		: null;
}

/** The report's cause as the PR view names it; a supported one stays "likely" (guideline 8). */
function causeOf(
	c: Extract<ThreadContext, { kind: "incident" }>,
): string | null {
	const confirmed = c.suspects.find((s) => s.status === "confirmed");
	if (confirmed) return confirmed.statement;
	const supported = c.suspects.find((s) => s.status === "supported");
	return supported ? `likely ${supported.statement}` : null;
}
