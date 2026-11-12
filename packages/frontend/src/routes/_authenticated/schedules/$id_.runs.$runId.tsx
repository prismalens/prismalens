// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Transcript } from "@/components/investigation/Transcript";
import { HypothesesCard } from "@/components/run/HypothesesCard";
import { ScheduleTriggerCard } from "@/components/run/TriggerCard";
import { Loading, NotFound, Problem } from "@/components/shared/State";
import { StatusLabel } from "@/components/shell/ThreadTree";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";
import { useInvestigationEventsHistory } from "@/lib/api/hooks/use-investigation-events";
import { useThreadStatuses } from "@/lib/api/hooks/use-threads-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { failureWords } from "@/lib/failure-words";
import { getErrorMessage } from "@/lib/get-error-message";
import { deriveTranscript } from "@/lib/investigation-events";
import { runStatusInfo } from "@/lib/thread-status";

export const Route = createFileRoute(
	"/_authenticated/schedules/$id_/runs/$runId",
)({
	component: ScheduledRunPage,
});

/** A scheduled check with no incident (#979): its status, what it found, and why it failed if it did. */
function ScheduledRunPage() {
	const { id, runId } = Route.useParams();
	const {
		data: run,
		isLoading,
		error,
		refetch,
	} = useQuery(orpc.investigations.get.queryOptions({ input: { id: runId } }));
	const statuses = useThreadStatuses([runId]);
	usePageTitle(run?.title ?? "Scheduled run");
	const live = run?.status === "pending" || run?.status === "running";
	const history = useInvestigationEventsHistory(runId, {
		pollMs: live ? 3000 : false,
	});
	// The poll stops at the terminal status; one last read takes the events written after it (adversary OBJ-016).
	const wasLive = useRef(false);
	const { catchUp } = history;
	useEffect(() => {
		if (live) wasLive.current = true;
		else if (wasLive.current) {
			wasLive.current = false;
			void catchUp();
		}
	}, [live, catchUp]);
	const items = useMemo(
		() => deriveTranscript(history.data ?? []),
		[history.data],
	);
	const back = (
		<Button variant="text" size="sm" asChild>
			<Link to="/schedules/$id" params={{ id }}>
				Back to the schedule
			</Link>
		</Button>
	);
	if (isLoading) return <Loading />;
	if (error)
		return (
			<Problem
				text={getErrorMessage(error)}
				onRetry={() => void refetch()}
				back={back}
			/>
		);
	if (!run) return <NotFound text="No run has this address." back={back} />;
	const info = statuses.data?.statuses[run.id] ?? runStatusInfo(run.status);
	return (
		<div className="flex h-full min-h-0 flex-col">
			<header
				data-title-row
				className="flex min-h-(--header-h) shrink-0 items-center gap-2 bg-surface-1 py-1.5 pr-3 pl-2"
			>
				<Button
					variant="ghost"
					size="icon-lg"
					aria-label="Back to the schedule"
					asChild
				>
					<Link to="/schedules/$id" params={{ id }}>
						<ChevronLeft />
					</Link>
				</Button>
				<h1 className="min-w-0 flex-1 truncate text-title">
					{run.title ?? "Scheduled run"}
				</h1>
				<span className="inline-flex items-center gap-2 text-body text-text-2">
					<StatusLabel info={info} now={Date.now()} />
				</span>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
				<div className="mx-auto grid max-w-(--reading-w) gap-5 pt-1">
					{/* A failed run is one quiet red line with its cause in words, not a card (sheet §10). */}
					{run.status === "failed" && (
						<p
							role="status"
							className="flex items-start gap-2 text-body text-danger"
							data-testid="scheduled-run-failure"
						>
							<TriangleAlert className="mt-1 size-3.5 shrink-0" aria-hidden />
							<span className="[overflow-wrap:anywhere]">
								{failureWords(run.error).what}
							</span>
						</p>
					)}
					{run.summary && (
						<div
							className="flex flex-col gap-2"
							data-testid="scheduled-run-found"
						>
							<p className="text-body text-text-1">{run.summary}</p>
							{run.rootCause && (
								<p className="text-body text-text-2">{run.rootCause}</p>
							)}
						</div>
					)}
					{run.report && (
						// The card is a list item, as it is inside the run page's transcript.
						<ul className="m-0 list-none p-0">
							<HypothesesCard
								report={run.report}
								at={run.completedAt}
								targetOf={() => null}
								onOpenFile={() => {}}
								onJump={() => {}}
							/>
						</ul>
					)}
					<ScheduleTriggerCard
						scheduleId={id}
						ranAt={run.startedAt ?? run.createdAt}
					/>
					<section aria-label="Transcript">
						{items.length ? (
							<Transcript
								items={items}
								incidentId={run.incidentId}
								cwd={run.workspace?.cwd}
								agent={[run.harness, run.model].filter(Boolean).join(", ")}
								runName={run.title ?? "Scheduled run"}
								briefBy="PrismaLens"
							/>
						) : (
							<p className="px-1 text-body text-text-3">
								{live ? "Starting the agent." : "This run recorded no steps."}
							</p>
						)}
					</section>
				</div>
			</div>
		</div>
	);
}
