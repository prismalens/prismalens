import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import {
	Activity,
	AlertCircle,
	AlertTriangle,
	ArrowRight,
	Brain,
	CheckCircle,
	Clock,
	ExternalLink,
	Lightbulb,
	MapPin,
	Timer,
} from "lucide-react";
import { ApiStatusCheck } from "@/components/ApiStatusCheck";
import { LLMWarningBanner } from "@/components/shared/LLMWarningBanner";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLlmSettings } from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";
import { cn } from "@/lib/utils";

// Setup check is handled by parent _authenticated layout route
export const Route = createFileRoute("/_authenticated/")({
	component: CommandCenter,
});

function CommandCenter() {
	const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);

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
		(a) => !a.incidentId && (a.status === "triggered" || a.status === "acknowledged"),
	);

	// Calculate MTTR (simplified - would need historical data in real implementation)
	const resolvedIncidents = incidents.filter(i => i.status === "resolved" && i.timeToResolve);
	const avgMttr = resolvedIncidents.length > 0
		? Math.round(resolvedIncidents.reduce((sum, i) => sum + (i.timeToResolve || 0), 0) / resolvedIncidents.length / 60000)
		: null;

	// Get selected incident
	const selectedIncident = selectedIncidentId
		? activeIncidents.find(i => i.id === selectedIncidentId)
		: activeIncidents[0];

	// Auto-select first incident if none selected
	if (!selectedIncidentId && activeIncidents.length > 0 && !selectedIncident) {
		setSelectedIncidentId(activeIncidents[0].id);
	}

	const isLoading = incidentsLoading || alertsLoading || recommendationsLoading;

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex justify-between items-center">
				<h1 className="text-3xl font-bold text-foreground">Command Center</h1>
				<div className="flex items-center gap-2">
					<Button variant="outline" size="sm" asChild>
						<Link to="/incidents">
							View All Incidents <ArrowRight className="ml-1 h-4 w-4" />
						</Link>
					</Button>
					<ApiStatusCheck />
				</div>
			</div>

			{/* LLM Warning Banner - only show when there are incidents to analyze */}
			{!isLlmConfigured && activeIncidents.length > 0 && (
				<LLMWarningBanner incidentCount={activeIncidents.length} />
			)}

			{/* Quick Stats Bar - All Clickable */}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<QuickStatCard
					title="Active"
					value={isLoading ? "-" : activeIncidents.length.toString()}
					icon={<AlertTriangle className="h-5 w-5" />}
					variant={activeIncidents.length > 0 ? "danger" : "success"}
					loading={incidentsLoading}
					href="/incidents?status=active"
				/>
				<QuickStatCard
					title="Investigating"
					value={isLoading ? "-" : investigatingIncidents.length.toString()}
					icon={<Brain className="h-5 w-5" />}
					variant={investigatingIncidents.length > 0 ? "warning" : "default"}
					loading={incidentsLoading}
					href="/incidents?status=investigating"
				/>
				<QuickStatCard
					title="Unassigned Alerts"
					value={isLoading ? "-" : unassignedAlerts.length.toString()}
					icon={<AlertCircle className="h-5 w-5" />}
					variant={unassignedAlerts.length > 0 ? "warning" : "default"}
					loading={alertsLoading}
					href="/alerts?tab=unmapped"
				/>
				<QuickStatCard
					title="MTTR"
					value={avgMttr !== null ? `${avgMttr}m` : "--"}
					icon={<Timer className="h-5 w-5" />}
					variant="default"
					loading={incidentsLoading}
					href="/incidents?tab=analytics"
				/>
			</div>

			{/* Master-Detail Layout for Active Incidents */}
			{activeIncidents.length === 0 && !incidentsLoading ? (
				<EmptyState />
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
												selectedIncident?.id === incident.id && "bg-accent/20 border-l-2 border-l-primary"
											)}
										>
											<div className="flex items-start justify-between gap-2">
												<div className="flex-1 min-w-0">
													<div className="flex items-center gap-2">
														<SeverityBadge severity={incident.severity as "critical" | "high" | "medium" | "low" | "info"} className="text-xs px-1.5 py-0" />
														<span className="text-xs text-muted-foreground font-mono">
															INC-{incident.id.slice(0, 6)}
														</span>
													</div>
													<p className="text-sm font-medium mt-1 truncate">
														{incident.title}
													</p>
													<p className="text-xs text-muted-foreground mt-0.5">
														{incident.service?.name || "Unknown service"} • {incident.alertCount ?? 0} alerts
													</p>
												</div>
												<div className="text-right">
													<span className="text-xs text-muted-foreground">
														{formatDistanceToNow(new Date(incident.triggeredAt), { addSuffix: false })}
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
							<IncidentDetailPanel incident={selectedIncident} isLlmConfigured={isLlmConfigured} />
						) : (
							<CardContent className="flex flex-col items-center justify-center h-[500px]">
								<AlertTriangle className="h-12 w-12 text-muted-foreground/50 mb-4" />
								<p className="text-muted-foreground">Select an incident to view details</p>
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
						icon={<AlertCircle className="h-5 w-5 text-orange-500" />}
						loading={alertsLoading}
						emptyText="All alerts are assigned to incidents"
						viewAllHref="/alerts?tab=unmapped"
						viewAllText="View All in Alerts"
					>
						{unassignedAlerts.slice(0, 3).map((alert) => (
							<div key={alert.id} className="flex items-center justify-between py-2">
								<div className="flex-1 min-w-0">
									<p className="text-sm font-medium truncate">{alert.title}</p>
									<p className="text-xs text-muted-foreground">
										{alert.service?.name || "Unknown"}
									</p>
								</div>
								<SeverityBadge severity={alert.severity as "critical" | "high" | "medium" | "low" | "info"} className="text-xs" />
							</div>
						))}
					</NeedsAttentionCard>

					{/* Pending Recommendations */}
					<NeedsAttentionCard
						title="Pending Recommendations"
						count={recommendations.length}
						icon={<Lightbulb className="h-5 w-5 text-amber-500" />}
						loading={recommendationsLoading}
						emptyText="No pending recommendations"
						viewAllHref="/incidents"
						viewAllText="View in Incidents"
					>
						{recommendations.slice(0, 3).map((rec) => (
							<div key={rec.id} className="flex items-center justify-between py-2">
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
						icon={<MapPin className="h-5 w-5 text-red-500" />}
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

// Quick Stat Card Component
interface QuickStatCardProps {
	title: string;
	value: string;
	icon: React.ReactNode;
	variant: "default" | "success" | "warning" | "danger";
	loading?: boolean;
	href: string;
}

function QuickStatCard({ title, value, icon, variant, loading, href }: QuickStatCardProps) {
	const variantStyles = {
		default: "bg-muted/50 hover:bg-muted",
		success: "bg-green-500/10 hover:bg-green-500/20 border-green-500/20",
		warning: "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/20",
		danger: "bg-red-500/10 hover:bg-red-500/20 border-red-500/20",
	};

	const iconStyles = {
		default: "text-muted-foreground",
		success: "text-green-600",
		warning: "text-amber-600",
		danger: "text-red-600",
	};

	return (
		<Link to={href}>
			<Card className={cn("transition-colors cursor-pointer border", variantStyles[variant])}>
				<CardContent className="p-4">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm font-medium text-muted-foreground">{title}</p>
							{loading ? (
								<Skeleton className="h-8 w-12 mt-1" />
							) : (
								<p className="text-2xl font-bold">{value}</p>
							)}
						</div>
						<div className={cn("p-2 rounded-full bg-background/50", iconStyles[variant])}>
							{icon}
						</div>
					</div>
				</CardContent>
			</Card>
		</Link>
	);
}

// Incident Detail Panel Component
interface IncidentDetailPanelProps {
	incident: {
		id: string;
		title: string;
		description?: string | null;
		status: string;
		severity: string;
		triggeredAt: string;
		alertCount?: number | null;
		service?: { id: string; name: string } | null;
		investigations?: Array<{
			id: string;
			status: string;
			confidence?: number | null;
			rootCause?: string | null;
			createdAt: string;
		}>;
	};
	isLlmConfigured: boolean;
}

function IncidentDetailPanel({ incident, isLlmConfigured }: IncidentDetailPanelProps) {
	const latestInvestigation = incident.investigations?.[0];

	return (
		<>
			<CardHeader className="pb-2">
				<div className="flex items-start justify-between">
					<div>
						<div className="flex items-center gap-2 mb-1">
							<span className="text-xs text-muted-foreground font-mono">
								INC-{incident.id.slice(0, 8)}
							</span>
							<SeverityBadge severity={incident.severity as "critical" | "high" | "medium" | "low" | "info"} />
							<StatusBadge status={incident.status as "triggered" | "acknowledged" | "investigating" | "identified" | "monitoring" | "resolved" | "closed" | "correlated" | "suppressed"} />
						</div>
						<CardTitle className="text-lg">{incident.title}</CardTitle>
						<p className="text-sm text-muted-foreground mt-1">
							Service: {incident.service?.name || "Unknown"} • {incident.alertCount ?? 0} alerts
						</p>
					</div>
					<Button variant="outline" size="sm" asChild>
						<Link to="/incidents/$id" params={{ id: incident.id }}>
							View Full Detail <ExternalLink className="ml-1 h-3 w-3" />
						</Link>
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				<Tabs defaultValue="overview" className="space-y-4">
					<TabsList>
						<TabsTrigger value="overview">Overview</TabsTrigger>
						<TabsTrigger value="alerts">Alerts ({incident.alertCount ?? 0})</TabsTrigger>
						<TabsTrigger value="investigation">Investigation</TabsTrigger>
						<TabsTrigger value="timeline">Timeline</TabsTrigger>
					</TabsList>

					<TabsContent value="overview" className="space-y-4">
						{incident.description && (
							<div>
								<h4 className="text-sm font-medium mb-1">Description</h4>
								<p className="text-sm text-muted-foreground">{incident.description}</p>
							</div>
						)}
						<div className="grid grid-cols-2 gap-4">
							<div className="p-3 rounded-lg bg-muted/50">
								<div className="text-xs text-muted-foreground">Duration</div>
								<div className="text-lg font-semibold">
									{formatDistanceToNow(new Date(incident.triggeredAt))}
								</div>
							</div>
							<div className="p-3 rounded-lg bg-muted/50">
								<div className="text-xs text-muted-foreground">Alerts</div>
								<div className="text-lg font-semibold">{incident.alertCount ?? 0}</div>
							</div>
						</div>
					</TabsContent>

					<TabsContent value="alerts">
						<div className="text-sm text-muted-foreground text-center py-8">
							<Link to="/incidents/$id" params={{ id: incident.id }} className="text-primary hover:underline">
								View all {incident.alertCount ?? 0} alerts in incident detail
							</Link>
						</div>
					</TabsContent>

					<TabsContent value="investigation" className="space-y-4">
						{latestInvestigation ? (
							<div className="space-y-3">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-2">
										<InvestigationStatusBadge status={latestInvestigation.status} />
										{latestInvestigation.confidence && (
											<span className="text-sm text-muted-foreground">
												{Math.round(latestInvestigation.confidence * 100)}% confidence
											</span>
										)}
									</div>
									<Button variant="outline" size="sm" asChild>
										<Link to="/investigations/$id" params={{ id: latestInvestigation.id }}>
											View Canvas
										</Link>
									</Button>
								</div>
								{latestInvestigation.status === "running" && (
									<div className="space-y-2">
										<Progress value={50} className="h-2" />
										<p className="text-xs text-muted-foreground text-center">
											Investigation in progress...
										</p>
									</div>
								)}
								{latestInvestigation.rootCause && (
									<div className="p-3 rounded-lg bg-muted/50">
										<h4 className="text-sm font-medium mb-1">Root Cause</h4>
										<p className="text-sm text-muted-foreground">
											{latestInvestigation.rootCause}
										</p>
									</div>
								)}
							</div>
						) : (
							<div className="flex flex-col items-center justify-center py-8">
								<Brain className="h-8 w-8 text-muted-foreground/50 mb-2" />
								<p className="text-sm text-muted-foreground mb-3">No investigation yet</p>
								{isLlmConfigured ? (
									<Button size="sm" asChild>
										<Link to="/incidents/$id" params={{ id: incident.id }}>
											<Brain className="h-4 w-4 mr-2" />
											Start Investigation
										</Link>
									</Button>
								) : (
									<p className="text-xs text-muted-foreground">
										Configure LLM in settings to enable AI investigations
									</p>
								)}
							</div>
						)}
					</TabsContent>

					<TabsContent value="timeline">
						<div className="text-sm text-muted-foreground text-center py-8">
							<Link to="/incidents/$id" params={{ id: incident.id }} className="text-primary hover:underline">
								View full timeline in incident detail
							</Link>
						</div>
					</TabsContent>
				</Tabs>

				{/* Quick Actions */}
				<div className="flex gap-2 mt-4 pt-4 border-t">
					<Button variant="outline" size="sm" asChild>
						<Link to="/incidents/$id" params={{ id: incident.id }}>
							Acknowledge
						</Link>
					</Button>
					<Button variant="outline" size="sm" asChild>
						<Link to="/incidents/$id" params={{ id: incident.id }}>
							Resolve
						</Link>
					</Button>
				</div>
			</CardContent>
		</>
	);
}

// Needs Attention Card Component
interface NeedsAttentionCardProps {
	title: string;
	count: number;
	icon: React.ReactNode;
	loading?: boolean;
	emptyText: string;
	viewAllHref: string;
	viewAllText: string;
	children?: React.ReactNode;
}

function NeedsAttentionCard({
	title,
	count,
	icon,
	loading,
	emptyText,
	viewAllHref,
	viewAllText,
	children,
}: NeedsAttentionCardProps) {
	return (
		<Card>
			<CardHeader className="pb-2">
				<div className="flex items-center justify-between">
					<CardTitle className="text-base font-medium flex items-center gap-2">
						{icon}
						{title}
					</CardTitle>
					<Badge variant="outline">{loading ? "-" : count}</Badge>
				</div>
			</CardHeader>
			<CardContent>
				{loading ? (
					<div className="space-y-2">
						{[1, 2, 3].map((i) => (
							<Skeleton key={i} className="h-10 w-full" />
						))}
					</div>
				) : count === 0 ? (
					<div className="flex flex-col items-center justify-center py-6">
						<CheckCircle className="h-8 w-8 text-green-500 mb-2" />
						<p className="text-sm text-muted-foreground">{emptyText}</p>
					</div>
				) : (
					<>
						<div className="divide-y divide-border">{children}</div>
						<Button variant="ghost" size="sm" className="w-full mt-2" asChild>
							<Link to={viewAllHref}>
								{viewAllText} <ArrowRight className="ml-1 h-4 w-4" />
							</Link>
						</Button>
					</>
				)}
			</CardContent>
		</Card>
	);
}

// Empty State Component
function EmptyState() {
	return (
		<Card>
			<CardContent className="flex flex-col items-center justify-center py-16">
				<CheckCircle className="h-16 w-16 text-green-500 mb-4" />
				<h2 className="text-xl font-semibold mb-2">All Clear!</h2>
				<p className="text-muted-foreground text-center mb-6 max-w-md">
					No active incidents. Your systems are healthy. While things are quiet, you might want to:
				</p>
				<div className="flex flex-wrap justify-center gap-3">
					<Button variant="outline" asChild>
						<Link to="/settings">Configure Integrations</Link>
					</Button>
					<Button variant="outline" asChild>
						<Link to="/services">Add Services</Link>
					</Button>
					<Button variant="outline" asChild>
						<Link to="/incidents">View Historical Incidents</Link>
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

// Helper Components
function InvestigationStatusBadge({ status }: { status: string }) {
	const statusConfig: Record<string, { icon: React.ElementType; className: string }> = {
		completed: {
			icon: CheckCircle,
			className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
		},
		running: {
			icon: Activity,
			className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
		},
		failed: {
			icon: AlertCircle,
			className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
		},
		pending: {
			icon: Clock,
			className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
		},
	};

	const config = statusConfig[status] || statusConfig.pending;
	const Icon = config.icon;

	return (
		<Badge variant="secondary" className={config.className}>
			<Icon className="w-3 h-3 mr-1" />
			{status}
		</Badge>
	);
}

function PriorityBadge({ priority }: { priority: string }) {
	const colors: Record<string, string> = {
		critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
		high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
		medium: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
		low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
	};

	return (
		<Badge variant="secondary" className={colors[priority.toLowerCase()] || colors.medium}>
			{priority}
		</Badge>
	);
}

// Skeleton Components
function IncidentListSkeleton() {
	return (
		<div className="divide-y divide-border">
			{[1, 2, 3, 4].map((i) => (
				<div key={i} className="px-4 py-3">
					<div className="flex items-center gap-2 mb-2">
						<Skeleton className="h-5 w-16" />
						<Skeleton className="h-4 w-20" />
					</div>
					<Skeleton className="h-4 w-3/4 mb-1" />
					<Skeleton className="h-3 w-1/2" />
				</div>
			))}
		</div>
	);
}

function IncidentDetailSkeleton() {
	return (
		<>
			<CardHeader className="pb-2">
				<div className="flex items-center gap-2 mb-2">
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-5 w-16" />
					<Skeleton className="h-5 w-20" />
				</div>
				<Skeleton className="h-6 w-3/4" />
				<Skeleton className="h-4 w-1/2 mt-2" />
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					<Skeleton className="h-10 w-full" />
					<div className="grid grid-cols-2 gap-4">
						<Skeleton className="h-20 w-full" />
						<Skeleton className="h-20 w-full" />
					</div>
				</div>
			</CardContent>
		</>
	);
}
