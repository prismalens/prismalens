import { lazy, Suspense, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

import { orpc } from "@/lib/api/orpc-client";
import { investigationKeys } from "@/lib/api/hooks/use-investigations-orpc";
import { useInvestigationStream } from "@/lib/api/hooks/use-investigation-stream";
import { InvestigationStreamPanel } from "@/components/investigation/InvestigationStreamPanel";
import { AgentExecutionsTab } from "@/components/investigation/AgentExecutionsTab";
import { AnalysisTab } from "@/components/investigation/AnalysisTab";
import { InvestigationDetailSkeleton } from "@/components/investigation/InvestigationDetailSkeleton";
import { InvestigationStatusBadge } from "@/components/investigation/investigation.utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
	)

	const isActive =
		investigation?.status === "running" ||
		investigation?.status === "pending";

	// SSE stream for real-time progress
	const stream = useInvestigationStream(investigationId, {
		enabled: isActive,
	});

	// When stream completes, refetch investigation data
	useEffect(() => {
		if (stream.status === "completed") {
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
		refetchInterval:
			isActive && stream.status === "error"
				? 3000
				: false,
	})

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
		)
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
						<Button variant="destructive" size="sm">
							<XCircle className="h-4 w-4 mr-2" />
							Cancel
						</Button>
					)}
				</div>
			</div>

			{/* Real-time stream panel for active investigations */}
			{isActive && stream.status !== "error" && (
				<InvestigationStreamPanel
					events={stream.events}
					latestText={stream.latestText}
					status={stream.status}
				/>
			)}

			{/* Polling fallback progress bar when SSE fails */}
			{isActive && stream.status === "error" && (
				<Card>
					<CardContent className="py-4">
						<div className="flex items-center justify-between mb-2">
							<span className="text-sm font-medium">Investigation Progress</span>
							<span className="text-sm text-muted-foreground">
								{jobProgress}%
							</span>
						</div>
						<Progress value={jobProgress} className="h-2" />
						{statusData?.job?.state && (
							<p className="text-xs text-muted-foreground mt-2">
								Job state: {statusData.job.state}
							</p>
						)}
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
						Agents ({investigation.agentExecutions?.length ?? 0})
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
									agentExecutions={investigation.agentExecutions ?? []}
									status={investigation.status}
									investigationId={investigationId}
								/>
							</Suspense>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="agents">
					<AgentExecutionsTab
						agentExecutions={investigation.agentExecutions ?? []}
					/>
				</TabsContent>

				<TabsContent value="analysis">
					<AnalysisTab investigation={investigation} />
				</TabsContent>
			</Tabs>
		</div>
	)
}
