// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import {
	AlertCircle,
	AlertTriangle,
	ArrowRight,
	Lightbulb,
	MapPin,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ApiStatusCheck } from "@/components/ApiStatusCheck";
import { DashboardEmptyState } from "@/components/dashboard/DashboardEmptyState";
import {
	IncidentDetailSkeleton,
	IncidentListSkeleton,
} from "@/components/dashboard/DashboardSkeletons";
import { IncidentDetailPanel } from "@/components/dashboard/IncidentDetailPanel";
import { NeedsAttentionCard } from "@/components/dashboard/NeedsAttentionCard";
import { PriorityBadge } from "@/components/investigation/investigation.utils";
import { PageHeader } from "@/components/layout";
import { LLMWarningBanner } from "@/components/shared/LLMWarningBanner";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLlmSettings } from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";
import { cn } from "@/lib/utils";

// Setup check is handled by parent _authenticated layout route
export const Route = createFileRoute("/_authenticated/")({
	component: CommandCenter,
});

function CommandCenter() {
	const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(
		null,
	);

	// Check if LLM is configured
	const { data: llmSettings } = useLlmSettings();
	const isLlmConfigured = !!llmSettings?.activeProvider;

	// Fetch active incidents (not resolved)
	const { data: incidents = [], isLoading: incidentsLoading } = useQuery(
		orpc.incidents.list.queryOptions({
			input: { limit: 50 },
		}),
	);

	// Fetch alerts for stats
	const { data: alerts = [], isLoading: alertsLoading } = useQuery(
		orpc.alerts.list.queryOptions({
			input: { status: "triggered", limit: 100 },
		}),
	);

	// Fetch pending recommendations
	const { data: recommendations = [], isLoading: recommendationsLoading } =
		useQuery(
			orpc.recommendations.list.queryOptions({
				input: { status: "pending", limit: 50 },
			}),
		);

	// Calculate stats
	const activeIncidents = incidents.filter(
		(i) => i.status !== "resolved" && i.status !== "closed",
	);
	const investigatingIncidents = incidents.filter(
		(i) => i.status === "investigating",
	);
	const unassignedAlerts = alerts.filter(
		(a) =>
			!a.incidentId &&
			(a.status === "triggered" || a.status === "acknowledged"),
	);

	// Calculate MTTR (simplified - would need historical data in real implementation)
	const resolvedIncidents = incidents.filter(
		(i) => i.status === "resolved" && i.timeToResolve,
	);
	const avgMttr =
		resolvedIncidents.length > 0
			? Math.round(
					resolvedIncidents.reduce(
						(sum, i) => sum + (i.timeToResolve || 0),
						0,
					) /
						resolvedIncidents.length /
						60000,
				)
			: null;

	// Get selected incident
	const selectedIncident = selectedIncidentId
		? activeIncidents.find((i) => i.id === selectedIncidentId)
		: activeIncidents[0];

	// Auto-select first incident if none selected
	useEffect(() => {
		if (!selectedIncidentId && activeIncidents.length > 0) {
			setSelectedIncidentId(activeIncidents[0].id);
		}
	}, [activeIncidents, selectedIncidentId]);

	const isLoading = incidentsLoading || alertsLoading || recommendationsLoading;

	return (
		<div className="space-y-6">
			<PageHeader
				title="Command Center"
				subtitle="Incident overview and status"
				actions={
					<>
						<Button variant="outline" size="sm" asChild>
							<Link to="/incidents">
								View All Incidents <ArrowRight className="ml-1 h-4 w-4" />
							</Link>
						</Button>
						<ApiStatusCheck />
					</>
				}
			/>

			{/* LLM Warning Banner - only show when there are incidents to analyze */}
			{!isLlmConfigured && activeIncidents.length > 0 && (
				<LLMWarningBanner incidentCount={activeIncidents.length} />
			)}

			{/* Quick Stats Summary */}
			<div className="flex items-center gap-4 text-sm text-muted-foreground">
				{isLoading ? (
					<Skeleton className="h-5 w-64" />
				) : (
					<>
						<Link
							to="/incidents"
							search={{ status: "active" }}
							className="hover:text-foreground transition-colors"
						>
							Active: {activeIncidents.length}
						</Link>
						<span>&middot;</span>
						<Link
							to="/incidents"
							search={{ status: "investigating" }}
							className="hover:text-foreground transition-colors"
						>
							Investigating: {investigatingIncidents.length}
						</Link>
						<span>&middot;</span>
						<Link
							to="/alerts"
							search={{ tab: "unmapped" }}
							className="hover:text-foreground transition-colors"
						>
							Unassigned: {unassignedAlerts.length}
						</Link>
						<span>&middot;</span>
						<span>MTTR: {avgMttr !== null ? `${avgMttr}m` : "--"}</span>
					</>
				)}
			</div>

			{/* Master-Detail Layout for Active Incidents */}
			{activeIncidents.length === 0 && !incidentsLoading ? (
				<DashboardEmptyState />
			) : (
				<div className="grid gap-6 lg:grid-cols-5">
					{/* Master Panel - Incident List (40%) */}
					<Card className="lg:col-span-2">
						<CardHeader className="pb-2">
							<div className="flex items-center justify-between">
								<CardTitle className="text-base font-medium">
									Active Incidents
								</CardTitle>
								<Badge variant="outline">{activeIncidents.length}</Badge>
							</div>
						</CardHeader>
						<CardContent className="p-0">
							{incidentsLoading ? (
								<IncidentListSkeleton />
							) : (
								<div className="divide-y divide-border max-h-[500px] overflow-y-auto">
									{activeIncidents.map((incident) => (
										<button
											type="button"
											key={incident.id}
											onClick={() => setSelectedIncidentId(incident.id)}
											className={cn(
												"w-full text-left px-4 py-3 hover:bg-accent/10 transition-colors",
												selectedIncident?.id === incident.id &&
													"bg-accent/20 border-l-2 border-l-primary",
											)}
										>
											<div className="flex items-start justify-between gap-2">
												<div className="flex-1 min-w-0">
													<div className="flex items-center gap-2">
														<SeverityBadge
															severity={
																incident.severity as
																	| "critical"
																	| "high"
																	| "medium"
																	| "low"
																	| "info"
															}
															className="text-xs px-1.5 py-0"
														/>
														<span className="text-xs text-muted-foreground font-mono">
															INC-{incident.id.slice(0, 6)}
														</span>
													</div>
													<p className="text-sm font-medium mt-1 truncate">
														{incident.title}
													</p>
													<p className="text-xs text-muted-foreground mt-0.5">
														{incident.service?.name || "Unknown service"} •{" "}
														{incident.alertCount ?? 0} alerts
													</p>
												</div>
												<div className="text-right">
													<span className="text-xs text-muted-foreground">
														{formatDistanceToNow(
															new Date(incident.triggeredAt),
															{ addSuffix: false },
														)}
													</span>
												</div>
											</div>
										</button>
									))}
								</div>
							)}
						</CardContent>
					</Card>

					{/* Detail Panel (60%) */}
					<Card className="lg:col-span-3">
						{incidentsLoading ? (
							<IncidentDetailSkeleton />
						) : selectedIncident ? (
							<IncidentDetailPanel
								incident={selectedIncident}
								isLlmConfigured={isLlmConfigured}
							/>
						) : (
							<CardContent className="flex flex-col items-center justify-center h-[500px]">
								<AlertTriangle className="h-12 w-12 text-muted-foreground/50 mb-4" />
								<p className="text-muted-foreground">
									Select an incident to view details
								</p>
							</CardContent>
						)}
					</Card>
				</div>
			)}

			{/* Needs Attention Section */}
			<div className="space-y-4">
				<h2 className="text-lg font-semibold">Needs Attention</h2>
				<div className="grid gap-4 lg:grid-cols-3">
					{/* Unassigned Alerts */}
					<NeedsAttentionCard
						title="Unassigned Alerts"
						count={unassignedAlerts.length}
						icon={<AlertCircle className="h-5 w-5 text-muted-foreground" />}
						loading={alertsLoading}
						emptyText="All alerts are assigned to incidents"
						viewAllHref="/alerts?tab=unmapped"
						viewAllText="View All in Alerts"
					>
						{unassignedAlerts.slice(0, 3).map((alert) => (
							<div
								key={alert.id}
								className="flex items-center justify-between py-2"
							>
								<div className="flex-1 min-w-0">
									<p className="text-sm font-medium truncate">{alert.title}</p>
									<p className="text-xs text-muted-foreground">
										{alert.service?.name || "Unknown"}
									</p>
								</div>
								<SeverityBadge
									severity={
										alert.severity as
											| "critical"
											| "high"
											| "medium"
											| "low"
											| "info"
									}
									className="text-xs"
								/>
							</div>
						))}
					</NeedsAttentionCard>

					{/* Pending Recommendations */}
					<NeedsAttentionCard
						title="Pending Recommendations"
						count={recommendations.length}
						icon={<Lightbulb className="h-5 w-5 text-muted-foreground" />}
						loading={recommendationsLoading}
						emptyText="No pending recommendations"
						viewAllHref="/incidents"
						viewAllText="View in Incidents"
					>
						{recommendations.slice(0, 3).map((rec) => (
							<div
								key={rec.id}
								className="flex items-center justify-between py-2"
							>
								<div className="flex-1 min-w-0">
									<p className="text-sm font-medium truncate">{rec.title}</p>
									<p className="text-xs text-muted-foreground">
										{rec.category || "General"}
									</p>
								</div>
								<PriorityBadge priority={rec.priority} />
							</div>
						))}
					</NeedsAttentionCard>

					{/* Alert Mapping Issues (placeholder - would need API support) */}
					<NeedsAttentionCard
						title="Alert Mapping Issues"
						count={0}
						icon={<MapPin className="h-5 w-5 text-muted-foreground" />}
						loading={false}
						emptyText="No mapping issues detected"
						viewAllHref="/alerts?tab=mapping-issues"
						viewAllText="Configure Mappings"
					>
						{/* Would show mapping issues here */}
					</NeedsAttentionCard>
				</div>
			</div>
		</div>
	);
}
