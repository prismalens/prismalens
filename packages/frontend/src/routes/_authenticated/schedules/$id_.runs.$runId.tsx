// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { HypothesesCard } from "@/components/run/HypothesesCard";
import { TickDot } from "@/components/schedules/TickDot";
import { Loading, NotFound, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";

export const Route = createFileRoute(
	"/_authenticated/schedules/$id_/runs/$runId",
)({
	component: ScheduledRunPage,
});

const STATUS = {
	pending: ["live", "Waiting to start"],
	running: ["live", "Running"],
	completed: ["ok", "Finished"],
	failed: ["bad", "Failed"],
	cancelled: ["muted", "Stopped"],
} as const;

/** A scheduled check with no incident (#979): its status, what it found, and why it failed if it did. */
function ScheduledRunPage() {
	const { id, runId } = Route.useParams();
	const {
		data: run,
		isLoading,
		error,
		refetch,
	} = useQuery(orpc.investigations.get.queryOptions({ input: { id: runId } }));
	usePageTitle(run?.title ?? "Scheduled run");
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
	const [tone, word] = STATUS[run.status];
	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex min-h-(--header-h) shrink-0 items-center gap-2 bg-surface-1 py-1.5 pr-3 pl-2">
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
					<TickDot tone={tone} />
					{word}
				</span>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
				<div className="mx-auto grid max-w-(--reading-w) gap-5 pt-1">
					{run.status === "failed" && (
						<div
							role="status"
							className="flex items-start gap-2.5 rounded-pool bg-surface-2 px-3.5 py-3 text-body"
						>
							<TriangleAlert
								className="mt-0.5 size-4 shrink-0 text-danger"
								aria-hidden
							/>
							<span>{run.error ?? "The run stopped."}</span>
						</div>
					)}
					{run.summary && (
						<section className="rounded-pool bg-surface-2 px-3.5 py-3">
							<h2 className="text-heading">What it found</h2>
							<p className="mt-1 text-body text-text-2">{run.summary}</p>
							{run.rootCause && (
								<p className="mt-2 text-body">{run.rootCause}</p>
							)}
						</section>
					)}
					{run.report && (
						<HypothesesCard
							report={run.report}
							at={run.completedAt}
							targetOf={() => null}
							onOpenFile={() => {}}
							onJump={() => {}}
							preview={false}
							onPreview={() => {}}
						/>
					)}
					{!run.summary && !run.report && run.status !== "failed" && (
						<p className="px-1 text-body text-text-3">
							The report shows here when the run finishes.
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
