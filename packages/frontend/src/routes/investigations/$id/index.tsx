import { lazy, Suspense } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	AlertCircle,
	ArrowLeft,
	Brain,
	CheckCircle,
	Clock,
	Lightbulb,
	RefreshCw,
	Search,
	XCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import type {
	AgentExecutionWithTools,
	InvestigationWithRelations,
} from "@prismalens/contracts";

import { orpc } from "@/lib/api/orpc-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Dynamically import React Flow to avoid SSR issues
const InvestigationCanvas = lazy(
	() => import("@/components/InvestigationCanvas"),
);

export const Route = createFileRoute("/investigations/$id/")({
	component: InvestigationDetailPage,
});

function InvestigationDetailPage() {
	const { id: investigationId } = Route.useParams();

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

	// Fetch investigation status (includes job queue info)
	const { data: statusData } = useQuery({
		...orpc.investigations.getStatus.queryOptions({
			input: { id: investigationId },
		}),
		enabled: !!investigation,
		refetchInterval:
			investigation?.status === "running" ||
			investigation?.status === "pending"
				? 3000
				: false,
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
						<StatusBadge status={investigation.status} />
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

			{/* Progress bar for running investigations */}
			{investigation.status === "running" && (
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
									investigationId={investigationId}
									data={buildCanvasData(investigation)}
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

function buildCanvasData(investigation: InvestigationWithRelations) {
	const agents = investigation.agentExecutions ?? [];
	const alertAgent = agents.find((a) => a.agentName === "alert_agent");
	const gathererAgent = agents.find((a) => a.agentName === "gatherer_agent");
	const analyzerAgent = agents.find((a) => a.agentName === "analyzer_agent");
	const recommenderAgent = agents.find(
		(a) => a.agentName === "recommender_agent",
	);

	return {
		alertData: alertAgent
			? {
					service: "Alert Validated",
					status: alertAgent.status,
				}
			: undefined,
		gathererData: gathererAgent
			? {
					logsCollected: gathererAgent.toolExecutions?.length ?? 0,
					filesAnalyzed: gathererAgent.toolExecutions?.length ?? 0,
					status: gathererAgent.status,
				}
			: undefined,
		analyzerData: analyzerAgent
			? {
					rootCause: investigation.rootCause || "Analyzing...",
					confidence: investigation.confidence ?? 0,
					status: analyzerAgent.status,
				}
			: undefined,
		recommenderData: recommenderAgent
			? {
					count: investigation.recommendations?.length ?? 0,
					status: recommenderAgent.status,
				}
			: undefined,
		status: investigation.status,
	};
}

function StatusBadge({ status }: { status: string }) {
	const statusConfig = {
		completed: {
			icon: CheckCircle,
			variant: "secondary" as const,
			className:
				"bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
		},
		running: {
			icon: Activity,
			variant: "secondary" as const,
			className:
				"bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
		},
		failed: {
			icon: AlertCircle,
			variant: "destructive" as const,
			className: "",
		},
		pending: {
			icon: Clock,
			variant: "secondary" as const,
			className:
				"bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
		},
	};

	const config =
		statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
	const Icon = config.icon;

	return (
		<Badge variant={config.variant} className={config.className}>
			<Icon className="w-3 h-3 mr-1" />
			{status}
		</Badge>
	);
}

function AgentExecutionsTab({
	agentExecutions,
}: {
	agentExecutions: AgentExecutionWithTools[];
}) {
	if (agentExecutions.length === 0) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center py-12">
					<Brain className="h-12 w-12 mb-4 opacity-50 text-muted-foreground" />
					<p className="text-lg font-medium text-muted-foreground">
						No agent executions yet
					</p>
					<p className="text-sm text-muted-foreground">
						Agent executions will appear here as the investigation progresses
					</p>
				</CardContent>
			</Card>
		);
	}

	const agentIcons: Record<string, React.ReactNode> = {
		alert_agent: <AlertCircle className="h-5 w-5 text-red-500" />,
		gatherer_agent: <Search className="h-5 w-5 text-blue-500" />,
		analyzer_agent: <Brain className="h-5 w-5 text-purple-500" />,
		recommender_agent: <Lightbulb className="h-5 w-5 text-green-500" />,
	};

	const agentColors: Record<string, string> = {
		alert_agent: "border-l-red-500",
		gatherer_agent: "border-l-blue-500",
		analyzer_agent: "border-l-purple-500",
		recommender_agent: "border-l-green-500",
	};

	return (
		<div className="space-y-4">
			{agentExecutions.map((agent) => (
				<Card
					key={agent.id}
					className={`border-l-4 ${agentColors[agent.agentName] || "border-l-gray-500"}`}
				>
					<CardHeader className="pb-2">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								{agentIcons[agent.agentName] || (
									<Brain className="h-5 w-5 text-gray-500" />
								)}
								<div>
									<CardTitle className="text-base capitalize">
										{agent.agentName.replace(/_/g, " ")}
									</CardTitle>
									<p className="text-xs text-muted-foreground">
										{agent.agentType}
									</p>
								</div>
							</div>
							<div className="flex items-center gap-2">
								<StatusBadge status={agent.status} />
								{agent.confidence && (
									<Badge variant="outline">
										{(agent.confidence * 100).toFixed(0)}% confidence
									</Badge>
								)}
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
							<div>
								<span className="text-muted-foreground">Started</span>
								<p className="font-medium">
									{agent.startedAt
										? formatDistanceToNow(new Date(agent.startedAt), {
												addSuffix: true,
											})
										: "-"}
								</p>
							</div>
							<div>
								<span className="text-muted-foreground">Duration</span>
								<p className="font-medium">
									{agent.executionTimeMs
										? `${(agent.executionTimeMs / 1000).toFixed(1)}s`
										: "-"}
								</p>
							</div>
							<div>
								<span className="text-muted-foreground">Tokens</span>
								<p className="font-medium">
									{agent.inputTokens || agent.outputTokens
										? `${agent.inputTokens ?? 0} / ${agent.outputTokens ?? 0}`
										: "-"}
								</p>
							</div>
							<div>
								<span className="text-muted-foreground">Tools Used</span>
								<p className="font-medium">
									{agent.toolExecutions?.length ?? 0}
								</p>
							</div>
						</div>

						{/* Tool Executions */}
						{agent.toolExecutions && agent.toolExecutions.length > 0 && (
							<div className="mt-4 pt-4 border-t">
								<p className="text-sm font-medium mb-2">Tool Executions</p>
								<div className="space-y-2">
									{agent.toolExecutions.map((tool) => (
										<div
											key={tool.id}
											className="flex items-center justify-between p-2 rounded bg-muted text-sm"
										>
											<div className="flex items-center gap-2">
												<Badge variant="outline" className="font-mono text-xs">
													{tool.toolName}
												</Badge>
												{tool.toolCategory && (
													<span className="text-muted-foreground text-xs">
														{tool.toolCategory}
													</span>
												)}
											</div>
											<div className="flex items-center gap-2">
												{tool.executionTimeMs && (
													<span className="text-xs text-muted-foreground">
														{tool.executionTimeMs}ms
													</span>
												)}
												<StatusBadge status={tool.status} />
											</div>
										</div>
									))}
								</div>
							</div>
						)}

						{/* Error display */}
						{agent.error && (
							<div className="mt-4 p-3 rounded bg-destructive/10 border border-destructive/20">
								<p className="text-sm text-destructive font-medium">Error</p>
								<p className="text-sm text-destructive/80">{agent.error}</p>
							</div>
						)}
					</CardContent>
				</Card>
			))}
		</div>
	);
}

function AnalysisTab({
	investigation,
}: {
	investigation: InvestigationWithRelations;
}) {
	return (
		<div className="grid gap-6 md:grid-cols-2">
			{/* Root Cause */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Root Cause Analysis</CardTitle>
				</CardHeader>
				<CardContent>
					{investigation.rootCause ? (
						<div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
							<p className="text-purple-900 dark:text-purple-100 font-medium">
								{investigation.rootCause}
							</p>
							<div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
								{investigation.confidence && (
									<span className="text-purple-700 dark:text-purple-300">
										Confidence:{" "}
										{(investigation.confidence * 100).toFixed(0)}%
									</span>
								)}
								{investigation.rootCauseCategory && (
									<Badge variant="outline">{investigation.rootCauseCategory}</Badge>
								)}
								{investigation.analysisMethod && (
									<span className="text-muted-foreground">
										Method: {investigation.analysisMethod}
									</span>
								)}
							</div>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							Root cause analysis not available yet
						</p>
					)}
				</CardContent>
			</Card>

			{/* Data Sources */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Data Sources Used</CardTitle>
				</CardHeader>
				<CardContent>
					{investigation.dataSourcesUsed &&
					investigation.dataSourcesUsed.length > 0 ? (
						<div className="flex flex-wrap gap-2">
							{investigation.dataSourcesUsed.map((source) => (
								<Badge key={source} variant="secondary">
									{source}
								</Badge>
							))}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							No data sources recorded
						</p>
					)}
				</CardContent>
			</Card>

			{/* Recommendations */}
			<Card className="md:col-span-2">
				<CardHeader>
					<CardTitle className="text-base">
						Recommendations ({investigation.recommendations?.length ?? 0})
					</CardTitle>
				</CardHeader>
				<CardContent>
					{investigation.recommendations &&
					investigation.recommendations.length > 0 ? (
						<div className="space-y-3">
							{investigation.recommendations.map((rec) => (
								<div
									key={rec.id}
									className="p-3 bg-muted rounded-lg flex items-start justify-between"
								>
									<div>
										<p className="font-medium">{rec.title}</p>
										<div className="flex items-center gap-2 mt-1">
											<PriorityBadge priority={rec.priority} />
											<Badge variant="outline">{rec.status}</Badge>
										</div>
									</div>
									<Link
										to="/incidents/$id"
										params={{ id: investigation.incidentId }}
										className="text-sm text-primary hover:underline"
									>
										View in Incident
									</Link>
								</div>
							))}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							No recommendations generated yet
						</p>
					)}
				</CardContent>
			</Card>

			{/* Metadata */}
			<Card className="md:col-span-2">
				<CardHeader>
					<CardTitle className="text-base">Investigation Metadata</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
						<div>
							<span className="text-muted-foreground">Started</span>
							<p className="font-medium">
								{investigation.startedAt
									? new Date(investigation.startedAt).toLocaleString()
									: "-"}
							</p>
						</div>
						<div>
							<span className="text-muted-foreground">Completed</span>
							<p className="font-medium">
								{investigation.completedAt
									? new Date(investigation.completedAt).toLocaleString()
									: "-"}
							</p>
						</div>
						<div>
							<span className="text-muted-foreground">Created</span>
							<p className="font-medium">
								{new Date(investigation.createdAt).toLocaleString()}
							</p>
						</div>
						<div>
							<span className="text-muted-foreground">Last Updated</span>
							<p className="font-medium">
								{new Date(investigation.updatedAt).toLocaleString()}
							</p>
						</div>
					</div>

					{investigation.error && (
						<div className="mt-4 p-3 rounded bg-destructive/10 border border-destructive/20">
							<p className="text-sm text-destructive font-medium">Error</p>
							<p className="text-sm text-destructive/80">
								{investigation.error}
							</p>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function PriorityBadge({ priority }: { priority: string }) {
	const colors: Record<string, string> = {
		critical:
			"bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
		high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
		medium:
			"bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
		low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
	};

	return (
		<Badge
			variant="secondary"
			className={colors[priority.toLowerCase()] || colors.medium}
		>
			{priority}
		</Badge>
	);
}

function InvestigationDetailSkeleton() {
	return (
		<div className="space-y-6">
			<Skeleton className="h-4 w-32" />
			<div className="flex items-start justify-between">
				<div className="space-y-2">
					<Skeleton className="h-8 w-64" />
					<Skeleton className="h-4 w-48" />
					<Skeleton className="h-4 w-96" />
				</div>
				<div className="flex gap-2">
					<Skeleton className="h-9 w-24" />
					<Skeleton className="h-9 w-24" />
				</div>
			</div>
			<Skeleton className="h-10 w-64" />
			<Skeleton className="h-[500px]" />
		</div>
	);
}
