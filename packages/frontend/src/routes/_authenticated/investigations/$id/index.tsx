// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Activity,
	AlertCircle,
	ArrowLeft,
	Brain,
	Lightbulb,
	RefreshCw,
	Search,
	XCircle,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { AgentExecutionsTab } from "@/components/investigation/AgentExecutionsTab";
import { AnalysisTab } from "@/components/investigation/AnalysisTab";
import { InvestigationDetailSkeleton } from "@/components/investigation/InvestigationDetailSkeleton";
import { InvestigationStreamPanel } from "@/components/investigation/InvestigationStreamPanel";
import { InvestigationStatusBadge } from "@/components/investigation/investigation.utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useInvestigationEventsHistory } from "@/lib/api/hooks/use-investigation-events";
import { useInvestigationStream } from "@/lib/api/hooks/use-investigation-stream";
import {
	investigationKeys,
	useCancelInvestigation,
} from "@/lib/api/hooks/use-investigations-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { transformLiveEventsToCanvas } from "@/lib/canvas";

// Dynamically import React Flow to avoid SSR issues
const InvestigationCanvas = lazy(
	() => import("@/components/InvestigationCanvas"),
);

export const Route = createFileRoute("/_authenticated/investigations/$id/")({
	component: InvestigationDetailPage,
});

function InvestigationDetailPage() {
	const { id: investigationId } = Route.useParams();
	const queryClient = useQueryClient();

	// Fetch investigation details
	const {
		data: investigation,
		isLoading,
		error,
		refetch,
		isRefetching,
	} = useQuery(
		orpc.investigations.get.queryOptions({ input: { id: investigationId } }),
	);

	const isActive =
		investigation?.status === "running" || investigation?.status === "pending";

	// Cancel a running/pending run (CANCEL slice, ADR-0018): the API publishes to the
	// Redis cancel channel (202-semantics) and the worker owns the terminal status; the
	// stream's terminal event + completion refetch update the view.
	const cancelInvestigation = useCancelInvestigation();

	// SSE stream for real-time progress
	const stream = useInvestigationStream(investigationId, {
		enabled: isActive,
	});

	// Once finished, the canvas replays the same durable canonical-event record
	// instead of `agentExecutions` (retired — real runs never populate it, see
	// `db-investigation-store.ts`), through the same transform the live path uses.
	const eventsHistory = useInvestigationEventsHistory(investigationId, {
		enabled: !!investigation && !isActive,
	});
	const events = isActive ? stream.events : (eventsHistory.data ?? []);

	const agentCount = useMemo(() => {
		if (!investigation) return 0;
		return transformLiveEventsToCanvas(
			events,
			investigation.status,
		).nodes.filter((node) => node.type === "agent").length;
	}, [events, investigation]);

	// When stream completes or fails, refetch investigation data
	useEffect(() => {
		if (stream.status === "completed" || stream.status === "failed") {
			queryClient.invalidateQueries({
				queryKey: investigationKeys.detail(investigationId),
			});
			queryClient.invalidateQueries({
				queryKey: investigationKeys.lists(),
			});
		}
	}, [stream.status, investigationId, queryClient]);

	// Fetch investigation status — polling fallback when SSE fails
	const { data: statusData } = useQuery({
		...orpc.investigations.getStatus.queryOptions({
			input: { id: investigationId },
		}),
		enabled: !!investigation,
		// Only poll if SSE is not streaming (fallback mode)
		refetchInterval: isActive && stream.status === "error" ? 3000 : false,
	});

	if (isLoading) {
		return <InvestigationDetailSkeleton />;
	}

	if (error || !investigation) {
		return (
			<div className="space-y-6">
				<Link
					to="/investigations"
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					Back to Investigations
				</Link>
				<div className="flex flex-col items-center justify-center py-12">
					<AlertCircle className="h-12 w-12 mb-4 text-destructive" />
					<p className="text-lg font-medium text-destructive">
						Failed to load investigation
					</p>
					<p className="text-sm text-muted-foreground">
						{error?.message || "Investigation not found"}
					</p>
				</div>
			</div>
		);
	}

	const jobProgress = statusData?.job?.progress ?? 0;

	return (
		<div className="space-y-6">
			{/* Back link */}
			<Link
				to="/investigations"
				className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft className="h-4 w-4" />
				Back to Investigations
			</Link>

			{/* Header */}
			<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
				<div className="space-y-2">
					<div className="flex items-center gap-3">
						<h1 className="text-2xl font-bold">Investigation</h1>
						<InvestigationStatusBadge status={investigation.status} />
					</div>
					<p className="text-sm font-mono text-muted-foreground">
						{investigation.id}
					</p>
					{investigation.summary && (
						<p className="text-muted-foreground max-w-2xl">
							{investigation.summary}
						</p>
					)}
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => refetch()}
						disabled={isRefetching}
					>
						<RefreshCw
							className={`h-4 w-4 mr-2 ${isRefetching ? "animate-spin" : ""}`}
						/>
						Refresh
					</Button>
					{(investigation.status === "running" ||
						investigation.status === "pending") && (
						<Button
							variant="destructive"
							size="sm"
							onClick={() =>
								cancelInvestigation.mutate({ id: investigationId })
							}
							disabled={cancelInvestigation.isPending}
						>
							<XCircle className="h-4 w-4 mr-2" />
							{cancelInvestigation.isPending ? "Cancelling..." : "Cancel"}
						</Button>
					)}
				</div>
			</div>

			{/* Real-time stream panel for active investigations */}
			{isActive && stream.status !== "error" && (
				// Every piece of the panel's state is per-investigation, and a
				// `$id` param change re-renders this route rather than remounting
				// it — so the panel is keyed to discard all of it at once (#280).
				<InvestigationStreamPanel
					key={investigationId}
					events={stream.events}
					latestText={stream.latestText}
					status={stream.status}
				/>
			)}

			{/* Polling fallback progress bar when SSE fails */}
			{isActive && stream.status === "error" && (
				<Card data-testid="investigation-fallback-panel">
					<CardHeader className="pb-3">
						<div className="flex items-center justify-between">
							<CardTitle className="text-base flex items-center gap-2">
								Investigation Progress
								<span
									data-testid="stream-fallback-badge"
									className="text-xs font-normal px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
								>
									Polling
								</span>
							</CardTitle>
							<span className="text-sm text-muted-foreground">
								{jobProgress}%
							</span>
						</div>
					</CardHeader>
					<CardContent className="pt-0 space-y-2">
						<Progress value={jobProgress} className="h-2" />
						<div className="flex items-center justify-between text-xs text-muted-foreground">
							<p data-testid="stream-fallback-message">
								Live stream unavailable — polling for progress
							</p>
							{statusData?.job?.state && (
								<span>Job state: {statusData.job.state}</span>
							)}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Tabs */}
			<Tabs defaultValue="canvas" className="space-y-4">
				<TabsList>
					<TabsTrigger value="canvas">
						<Search className="h-4 w-4 mr-1" />
						Canvas
					</TabsTrigger>
					<TabsTrigger value="agents">
						<Brain className="h-4 w-4 mr-1" />
						Agents ({agentCount})
					</TabsTrigger>
					<TabsTrigger value="analysis">
						<Lightbulb className="h-4 w-4 mr-1" />
						Analysis
					</TabsTrigger>
				</TabsList>

				<TabsContent value="canvas">
					<Card>
						<CardHeader>
							<CardTitle className="text-base">Investigation Flow</CardTitle>
						</CardHeader>
						<CardContent>
							<Suspense
								fallback={
									<div className="h-[500px] flex items-center justify-center bg-muted rounded-lg">
										<div className="text-center">
											<Activity className="h-8 w-8 animate-pulse mx-auto mb-2 text-muted-foreground" />
											<p className="text-sm text-muted-foreground">
												Loading canvas...
											</p>
										</div>
									</div>
								}
							>
								<InvestigationCanvas
									status={investigation.status}
									investigationId={investigationId}
									streamEvents={isActive ? stream.events : eventsHistory.data}
									streamConnecting={
										isActive
											? stream.status === "connecting"
											: eventsHistory.isLoading
									}
								/>
							</Suspense>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="agents">
					<AgentExecutionsTab events={events} status={investigation.status} />
				</TabsContent>

				<TabsContent value="analysis">
					<AnalysisTab investigation={investigation} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
