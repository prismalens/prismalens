import { lazy, Suspense, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Activity,
	AlertCircle,
	ArrowLeft,
	Brain,
	Lightbulb,
	Play,
	RefreshCw,
	Search,
	XCircle,
} from "lucide-react";

import { orpc } from "@/lib/api/orpc-client";
import {
	investigationKeys,
	useRunInvestigation,
} from "@/lib/api/hooks/use-investigations-orpc";
import {
	type EngineReport,
	useEngineInvestigationStream,
} from "@/lib/api/hooks/use-engine-investigation-stream";
import { EngineReportView } from "@/components/investigation/EngineReportView";
import { EngineStreamPanel } from "@/components/investigation/EngineStreamPanel";
import { AgentExecutionsTab } from "@/components/investigation/AgentExecutionsTab";
import { AnalysisTab } from "@/components/investigation/AnalysisTab";
import { InvestigationDetailSkeleton } from "@/components/investigation/InvestigationDetailSkeleton";
import { InvestigationStatusBadge } from "@/components/investigation/investigation.utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
	);

	const runMutation = useRunInvestigation();

	// `pendingRun` connects the live view the instant we kick off a run, rather than waiting
	// for the get-query to reflect "running" (the run is fire-and-forget server-side; the SSE
	// stream + DB are the channels we observe). On reload mid-run, status==="running" covers it.
	const [pendingRun, setPendingRun] = useState(false);
	const isRunning = investigation?.status === "running";
	const live = isRunning || pendingRun;

	// SSE stream for the in-process engine
	const stream = useEngineInvestigationStream(investigationId, {
		enabled: live,
	});

	// When the stream ends, refetch the record (to load the persisted report) and close the
	// live window.
	useEffect(() => {
		if (stream.status === "completed" || stream.status === "error") {
			setPendingRun(false);
			queryClient.invalidateQueries({
				queryKey: investigationKeys.detail(investigationId),
			});
			queryClient.invalidateQueries({
				queryKey: investigationKeys.lists(),
			});
		}
	}, [stream.status, investigationId, queryClient]);

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

	// Ordered-evidence report: live from the stream, else the persisted rawOutput.
	const report: EngineReport | null =
		stream.report ?? (investigation.rawOutput as unknown as EngineReport | null);

	const isFinished =
		investigation.status === "completed" || investigation.status === "failed";

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
					{!live && (
						<Button
							size="sm"
							onClick={() => {
								setPendingRun(true);
								runMutation.mutate(
									{ id: investigationId },
									{ onError: () => setPendingRun(false) },
								);
							}}
							disabled={runMutation.isPending}
						>
							<Play className="h-4 w-4 mr-2" />
							{isFinished ? "Re-run with engine" : "Run with engine"}
						</Button>
					)}
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
					{live && (
						<Button variant="destructive" size="sm">
							<XCircle className="h-4 w-4 mr-2" />
							Cancel
						</Button>
					)}
				</div>
			</div>

			{runMutation.isError && (
				<p className="text-sm text-destructive">
					{(runMutation.error as Error).message}
				</p>
			)}

			{/* Live engine investigation stream */}
			{(live || stream.steps.length > 0) && (
				<EngineStreamPanel
					steps={stream.steps}
					status={stream.status}
					error={stream.error}
				/>
			)}

			{/* Ordered-evidence report (live or persisted) */}
			{report && <EngineReportView report={report} />}

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
	);
}
