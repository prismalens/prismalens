// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadContext, ThreadSession } from "@prismalens/contracts";
import { type ReactNode, useEffect } from "react";
import { useAgentChoice } from "@/components/agent/AgentPicker";
import { Loading } from "@/components/shared/State";
import {
	useRevokeTreeAllowance,
	useThreadTree,
} from "@/lib/api/hooks/use-thread-tree-orpc";
import { PullRequestList, type PullRequestView } from "./PullRequests";
import {
	MachineAgentSection,
	PanelSection,
	PlanSection,
	ThreadTreeSection,
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
}: {
	threadId: string;
	context: ThreadContext | undefined;
	live: boolean;
	session?: ThreadSession;
	/** The run's steps, filtered and timestamped; absent when it ran none. */
	steps?: ReactNode;
	section?: string;
	focusPr?: string;
}) {
	const tree = useThreadTree(threadId, live);
	const revoke = useRevokeTreeAllowance();
	const { harnesses } = useAgentChoice();
	useEffect(() => {
		if (!section) return;
		document
			.getElementById(`panel-section-${section}`)
			?.scrollIntoView({ block: "start" });
	}, [section]);
	if (!context) return <Loading rows={3} />;
	const prs = context.pullRequests as PullRequestView[];
	const nodes = tree.data?.nodes ?? [];
	const agentLabel =
		harnesses.find((h) => h.id === context.agent.harness)?.label ?? null;
	return (
		<PanelStack>
			{prs.length > 0 && (
				<PanelSection id="pull-requests" title="Pull requests">
					<PullRequestList prs={prs} focusId={focusPr} />
				</PanelSection>
			)}
			{tree.data && (nodes.length > 1 || tree.data.allowance) && (
				<PanelSection id="threads" title="Threads">
					<ThreadTreeSection
						tree={tree.data}
						currentId={threadId}
						isHost={context.machine.isHost}
						onRevoke={() => revoke.mutate({ id: tree.data.rootId })}
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
