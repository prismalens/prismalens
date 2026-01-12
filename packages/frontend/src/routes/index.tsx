import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	AlertCircle,
	AlertTriangle,
	ArrowRight,
	Brain,
	CheckCircle,
	Clock,
	Lightbulb,
	Server,
	TrendingDown,
	TrendingUp,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { orpc } from "@/lib/api/orpc-client";
import { ApiStatusCheck } from "@/components/ApiStatusCheck";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	// Fetch dashboard data
	const { data: alerts = [], isLoading: alertsLoading } = useQuery(
		orpc.alerts.list.queryOptions({
			input: { status: "triggered", limit: 5 },
		}),
	);

	const { data: incidents = [], isLoading: incidentsLoading } = useQuery(
		orpc.incidents.list.queryOptions({
			input: { limit: 5 },
		}),
	);

	const { data: investigations = [], isLoading: investigationsLoading } =
		useQuery(
			orpc.investigations.list.queryOptions({
				input: { limit: 5 },
			}),
		);

	const { data: services = [], isLoading: servicesLoading } = useQuery(
		orpc.services.list.queryOptions({
			input: { limit: 100 },
		}),
	);

	const { data: recommendations = [], isLoading: recommendationsLoading } =
		useQuery(
			orpc.recommendations.list.queryOptions({
				input: { status: "pending", limit: 5 },
			}),
		);

	// Calculate stats
	const activeAlerts = alerts.filter(
		(a) => a.status === "triggered" || a.status === "acknowledged",
	).length;
	const activeIncidents = incidents.filter(
		(i) => i.status !== "resolved" && i.status !== "closed",
	).length;
	const runningInvestigations = investigations.filter(
		(i) => i.status === "running",
	).length;
	const pendingRecommendations = recommendations.length;

	// Service health summary
	const criticalServices = services.filter((s) => s.tier === "tier_1").length;
	const servicesWithAlerts = services.filter(
		(s) => s.alertCount && s.alertCount > 0,
	).length;

	return (
		<div className="space-y-6">
			<div className="flex justify-between items-center">
				<h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
				<ApiStatusCheck />
			</div>

			{/* Stats Grid */}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard
					title="Active Alerts"
					value={alertsLoading ? "-" : activeAlerts.toString()}
					icon={<AlertCircle className="h-6 w-6 text-red-500" />}
					trend={
						activeAlerts > 0
							? `${activeAlerts} need attention`
							: "All clear"
					}
					trendUp={activeAlerts > 0}
					loading={alertsLoading}
				/>
				<StatCard
					title="Active Incidents"
					value={incidentsLoading ? "-" : activeIncidents.toString()}
					icon={<AlertTriangle className="h-6 w-6 text-orange-500" />}
					trend={`${incidents.length} total`}
					trendUp={activeIncidents > 0}
					loading={incidentsLoading}
				/>
				<StatCard
					title="Investigations"
					value={investigationsLoading ? "-" : investigations.length.toString()}
					icon={<Brain className="h-6 w-6 text-blue-500" />}
					trend={`${runningInvestigations} running`}
					loading={investigationsLoading}
				/>
				<StatCard
					title="Pending Actions"
					value={recommendationsLoading ? "-" : pendingRecommendations.toString()}
					icon={<Lightbulb className="h-6 w-6 text-amber-500" />}
					trend="AI recommendations"
					loading={recommendationsLoading}
				/>
			</div>

			{/* Main Content Grid */}
			<div className="grid gap-6 lg:grid-cols-2">
				{/* Recent Alerts */}
				<Card>
					<CardHeader className="flex flex-row items-center justify-between pb-2">
						<CardTitle className="text-base font-medium">
							Recent Alerts
						</CardTitle>
						<Button variant="ghost" size="sm" asChild>
							<Link to="/alerts">
								View all <ArrowRight className="ml-1 h-4 w-4" />
							</Link>
						</Button>
					</CardHeader>
					<CardContent className="p-0">
						{alertsLoading ? (
							<AlertsSkeleton />
						) : alerts.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-8">
								<CheckCircle className="h-8 w-8 text-green-500 mb-2" />
								<p className="text-sm text-muted-foreground">No active alerts</p>
							</div>
						) : (
							<div className="divide-y divide-border">
								{alerts.slice(0, 5).map((alert) => (
									<Link
										key={alert.id}
										to="/alerts"
										className="flex items-center justify-between px-4 py-3 hover:bg-accent/10 transition-colors"
									>
										<div className="flex-1 min-w-0">
											<p className="text-sm font-medium truncate">
												{alert.title}
											</p>
											<p className="text-xs text-muted-foreground">
												{alert.service?.name || "Unknown service"}
											</p>
										</div>
										<div className="flex items-center gap-2 ml-2">
											<SeverityBadge severity={alert.severity} />
											<span className="text-xs text-muted-foreground">
												{formatDistanceToNow(new Date(alert.triggeredAt), {
													addSuffix: true,
												})}
											</span>
										</div>
									</Link>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Active Incidents */}
				<Card>
					<CardHeader className="flex flex-row items-center justify-between pb-2">
						<CardTitle className="text-base font-medium">
							Active Incidents
						</CardTitle>
						<Button variant="ghost" size="sm" asChild>
							<Link to="/incidents">
								View all <ArrowRight className="ml-1 h-4 w-4" />
							</Link>
						</Button>
					</CardHeader>
					<CardContent className="p-0">
						{incidentsLoading ? (
							<IncidentsSkeleton />
						) : incidents.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-8">
								<CheckCircle className="h-8 w-8 text-green-500 mb-2" />
								<p className="text-sm text-muted-foreground">No active incidents</p>
							</div>
						) : (
							<div className="divide-y divide-border">
								{incidents.slice(0, 5).map((incident) => (
									<Link
										key={incident.id}
										to="/incidents/$id"
										params={{ id: incident.id }}
										className="flex items-center justify-between px-4 py-3 hover:bg-accent/10 transition-colors"
									>
										<div className="flex-1 min-w-0">
											<p className="text-sm font-medium truncate">
												{incident.title}
											</p>
											<p className="text-xs text-muted-foreground">
												{incident.service?.name || "Unknown service"} •{" "}
												{incident.alertCount ?? 0} alerts
											</p>
										</div>
										<div className="flex items-center gap-2 ml-2">
											<StatusBadge status={incident.status} />
										</div>
									</Link>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Running Investigations */}
				<Card>
					<CardHeader className="flex flex-row items-center justify-between pb-2">
						<CardTitle className="text-base font-medium">
							Investigations
						</CardTitle>
						<Button variant="ghost" size="sm" asChild>
							<Link to="/investigations">
								View all <ArrowRight className="ml-1 h-4 w-4" />
							</Link>
						</Button>
					</CardHeader>
					<CardContent>
						{investigationsLoading ? (
							<InvestigationsSkeleton />
						) : investigations.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-8">
								<Brain className="h-8 w-8 text-muted-foreground mb-2" />
								<p className="text-sm text-muted-foreground">
									No investigations yet
								</p>
							</div>
						) : (
							<div className="space-y-3">
								{investigations.slice(0, 4).map((investigation) => (
									<Link
										key={investigation.id}
										to="/investigations/$id"
										params={{ id: investigation.id }}
										className="block p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
									>
										<div className="flex items-center justify-between mb-2">
											<span className="text-sm font-mono text-muted-foreground">
												{investigation.id.slice(0, 8)}...
											</span>
											<InvestigationStatusBadge status={investigation.status} />
										</div>
										{investigation.rootCause && (
											<p className="text-sm line-clamp-1">
												{investigation.rootCause}
											</p>
										)}
										{investigation.confidence && (
											<div className="flex items-center gap-2 mt-2">
												<Progress
													value={investigation.confidence * 100}
													className="h-1.5 flex-1"
												/>
												<span className="text-xs text-muted-foreground">
													{(investigation.confidence * 100).toFixed(0)}%
												</span>
											</div>
										)}
									</Link>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Pending Recommendations */}
				<Card>
					<CardHeader className="flex flex-row items-center justify-between pb-2">
						<CardTitle className="text-base font-medium">
							Pending Recommendations
						</CardTitle>
					</CardHeader>
					<CardContent>
						{recommendationsLoading ? (
							<RecommendationsSkeleton />
						) : recommendations.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-8">
								<Lightbulb className="h-8 w-8 text-muted-foreground mb-2" />
								<p className="text-sm text-muted-foreground">
									No pending recommendations
								</p>
							</div>
						) : (
							<div className="space-y-3">
								{recommendations.slice(0, 4).map((rec) => (
									<div
										key={rec.id}
										className="p-3 rounded-lg bg-muted/50 border-l-4 border-l-amber-500"
									>
										<p className="text-sm font-medium">{rec.title}</p>
										<div className="flex items-center gap-2 mt-1">
											<PriorityBadge priority={rec.priority} />
											{rec.category && (
												<Badge variant="outline" className="text-xs">
													{rec.category}
												</Badge>
											)}
										</div>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Service Health Summary */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between pb-2">
					<CardTitle className="text-base font-medium">
						Service Health Summary
					</CardTitle>
					<Button variant="ghost" size="sm" asChild>
						<Link to="/services">
							View all services <ArrowRight className="ml-1 h-4 w-4" />
						</Link>
					</Button>
				</CardHeader>
				<CardContent>
					{servicesLoading ? (
						<ServicesSkeleton />
					) : services.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-8">
							<Server className="h-8 w-8 text-muted-foreground mb-2" />
							<p className="text-sm text-muted-foreground">
								No services in catalog
							</p>
						</div>
					) : (
						<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
							<div className="p-4 rounded-lg bg-muted/50">
								<div className="text-2xl font-bold">{services.length}</div>
								<div className="text-sm text-muted-foreground">
									Total Services
								</div>
							</div>
							<div className="p-4 rounded-lg bg-red-500/10">
								<div className="text-2xl font-bold text-red-600">
									{criticalServices}
								</div>
								<div className="text-sm text-muted-foreground">
									Tier 1 (Critical)
								</div>
							</div>
							<div className="p-4 rounded-lg bg-orange-500/10">
								<div className="text-2xl font-bold text-orange-600">
									{servicesWithAlerts}
								</div>
								<div className="text-sm text-muted-foreground">
									With Active Alerts
								</div>
							</div>
							<div className="p-4 rounded-lg bg-green-500/10">
								<div className="text-2xl font-bold text-green-600">
									{services.length - servicesWithAlerts}
								</div>
								<div className="text-sm text-muted-foreground">Healthy</div>
							</div>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function StatCard({
	title,
	value,
	icon,
	trend,
	trendUp,
	loading,
}: {
	title: string;
	value: string;
	icon: React.ReactNode;
	trend: string;
	trendUp?: boolean;
	loading?: boolean;
}) {
	return (
		<Card>
			<CardContent className="pt-5">
				{loading ? (
					<div className="flex items-center">
						<Skeleton className="h-6 w-6 rounded" />
						<div className="ml-5 flex-1">
							<Skeleton className="h-4 w-24 mb-2" />
							<Skeleton className="h-8 w-16" />
						</div>
					</div>
				) : (
					<div className="flex items-center">
						<div className="flex-shrink-0">{icon}</div>
						<div className="ml-5 w-0 flex-1">
							<p className="text-sm font-medium text-muted-foreground truncate">
								{title}
							</p>
							<p className="text-2xl font-semibold text-foreground">{value}</p>
						</div>
					</div>
				)}
			</CardContent>
			<CardFooter className="bg-muted/50 py-3">
				{loading ? (
					<Skeleton className="h-4 w-32" />
				) : (
					<div className="flex items-center gap-1 text-sm text-muted-foreground">
						{trendUp !== undefined &&
							(trendUp ? (
								<TrendingUp className="h-4 w-4 text-red-500" />
							) : (
								<TrendingDown className="h-4 w-4 text-green-500" />
							))}
						{trend}
					</div>
				)}
			</CardFooter>
		</Card>
	);
}

function InvestigationStatusBadge({ status }: { status: string }) {
	const statusConfig: Record<
		string,
		{ icon: React.ElementType; className: string }
	> = {
		completed: {
			icon: CheckCircle,
			className:
				"bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
		},
		running: {
			icon: Activity,
			className:
				"bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
		},
		failed: {
			icon: AlertCircle,
			className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
		},
		pending: {
			icon: Clock,
			className:
				"bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
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

function AlertsSkeleton() {
	return (
		<div className="divide-y divide-border">
			{["a1", "a2", "a3"].map((id) => (
				<div key={id} className="px-4 py-3 flex items-center justify-between">
					<div className="space-y-1">
						<Skeleton className="h-4 w-32" />
						<Skeleton className="h-3 w-24" />
					</div>
					<div className="flex items-center gap-2">
						<Skeleton className="h-5 w-16" />
						<Skeleton className="h-3 w-20" />
					</div>
				</div>
			))}
		</div>
	);
}

function IncidentsSkeleton() {
	return (
		<div className="divide-y divide-border">
			{["i1", "i2", "i3"].map((id) => (
				<div key={id} className="px-4 py-3 flex items-center justify-between">
					<div className="space-y-1">
						<Skeleton className="h-4 w-40" />
						<Skeleton className="h-3 w-28" />
					</div>
					<Skeleton className="h-5 w-20" />
				</div>
			))}
		</div>
	);
}

function InvestigationsSkeleton() {
	return (
		<div className="space-y-3">
			{["inv1", "inv2", "inv3"].map((id) => (
				<div key={id} className="p-3 rounded-lg bg-muted/50">
					<div className="flex items-center justify-between mb-2">
						<Skeleton className="h-4 w-20" />
						<Skeleton className="h-5 w-16" />
					</div>
					<Skeleton className="h-4 w-full" />
					<div className="flex items-center gap-2 mt-2">
						<Skeleton className="h-1.5 flex-1" />
						<Skeleton className="h-3 w-8" />
					</div>
				</div>
			))}
		</div>
	);
}

function RecommendationsSkeleton() {
	return (
		<div className="space-y-3">
			{["r1", "r2", "r3"].map((id) => (
				<div
					key={id}
					className="p-3 rounded-lg bg-muted/50 border-l-4 border-l-muted"
				>
					<Skeleton className="h-4 w-3/4 mb-2" />
					<div className="flex items-center gap-2">
						<Skeleton className="h-5 w-12" />
						<Skeleton className="h-5 w-16" />
					</div>
				</div>
			))}
		</div>
	);
}

function ServicesSkeleton() {
	return (
		<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
			{["s1", "s2", "s3", "s4"].map((id) => (
				<div key={id} className="p-4 rounded-lg bg-muted/50">
					<Skeleton className="h-8 w-12 mb-1" />
					<Skeleton className="h-4 w-24" />
				</div>
			))}
		</div>
	);
}
