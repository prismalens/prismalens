import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import {
	Brain,
	ExternalLink,
} from "lucide-react";

import { InvestigationStatusBadge } from "@/components/investigation/investigation.utils";

import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface IncidentDetailPanelProps {
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
			rootCause?: string | null;
			createdAt: string;
		}>;
	};
	isLlmConfigured: boolean;
}

export function IncidentDetailPanel({ incident, isLlmConfigured }: IncidentDetailPanelProps) {
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

