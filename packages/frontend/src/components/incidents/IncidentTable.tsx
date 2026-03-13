/**
 * Incident Table Component
 *
 * Displays incidents in a table with actions
 */

import { Link } from "@tanstack/react-router";
import type { IncidentWithRelations } from "@prismalens/contracts";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty-state";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
	Eye,
	CheckCircle,
	Search,
	AlertTriangle,
	Clock,
	FileText,
} from "lucide-react";

export interface IncidentTableProps {
	incidents: IncidentWithRelations[];
	isLoading?: boolean;
	onAcknowledge?: (id: string) => void;
	onInvestigate?: (id: string) => void;
}

const priorityColors: Record<string, string> = {
	p1: "bg-red-600 text-white",
	p2: "bg-orange-500 text-white",
	p3: "bg-yellow-500 text-black",
	p4: "bg-blue-500 text-white",
	p5: "bg-gray-500 text-white",
};

function formatDuration(ms: number | null): string {
	if (!ms) return "-";
	const minutes = Math.floor(ms / 60000);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	}
	return `${minutes}m`;
}

function formatTimeAgo(date: string): string {
	const now = new Date();
	const then = new Date(date);
	const diffMs = now.getTime() - then.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMins / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffDays > 0) return `${diffDays}d ago`;
	if (diffHours > 0) return `${diffHours}h ago`;
	if (diffMins > 0) return `${diffMins}m ago`;
	return "Just now";
}

export function IncidentTable({
	incidents,
	isLoading,
	onAcknowledge,
	onInvestigate,
}: IncidentTableProps) {
	if (isLoading) {
		return <IncidentTableSkeleton />;
	}

	if (incidents.length === 0) {
		return (
			<EmptyState
				icon={FileText}
				title="No incidents found"
				description="Incidents will appear here when alerts are correlated"
			/>
		);
	}

	return (
		<TooltipProvider>
			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-[80px]">#</TableHead>
							<TableHead>Title</TableHead>
							<TableHead className="w-[100px]">Severity</TableHead>
							<TableHead className="w-[100px]">Priority</TableHead>
							<TableHead className="w-[120px]">Status</TableHead>
							<TableHead className="w-[120px]">Service</TableHead>
							<TableHead className="w-[80px]">Alerts</TableHead>
							<TableHead className="w-[100px]">Triggered</TableHead>
							<TableHead className="w-[100px]">TTR</TableHead>
							<TableHead className="w-[150px] text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{incidents.map((incident) => (
							<TableRow key={incident.id}>
								<TableCell className="font-mono text-sm">
									INC-{incident.number}
								</TableCell>
								<TableCell>
									<Link
										to="/incidents/$id"
										params={{ id: incident.id }}
										className="font-medium hover:underline hover:text-primary"
									>
										{incident.title}
									</Link>
									{incident.description && (
										<p className="text-sm text-muted-foreground truncate max-w-[300px]">
											{incident.description}
										</p>
									)}
								</TableCell>
								<TableCell>
									<SeverityBadge severity={incident.severity} />
								</TableCell>
								<TableCell>
									<Badge className={priorityColors[incident.priority] || "bg-gray-500"}>
										{incident.priority.toUpperCase()}
									</Badge>
								</TableCell>
								<TableCell>
									<StatusBadge status={incident.status} />
								</TableCell>
								<TableCell>
									{incident.service ? (
										<Link
											to="/services/$id"
											params={{ id: incident.service.id }}
											search={{ tab: "general" }}
											className="text-sm hover:underline hover:text-primary"
										>
											{incident.service.name}
										</Link>
									) : (
										<span className="text-muted-foreground">-</span>
									)}
								</TableCell>
								<TableCell>
									<div className="flex items-center gap-1">
										<AlertTriangle className="h-3 w-3 text-muted-foreground" />
										<span>{incident.alertCount}</span>
									</div>
								</TableCell>
								<TableCell>
									<Tooltip>
										<TooltipTrigger>
											<div className="flex items-center gap-1 text-sm">
												<Clock className="h-3 w-3 text-muted-foreground" />
												{formatTimeAgo(incident.triggeredAt)}
											</div>
										</TooltipTrigger>
										<TooltipContent>
											{new Date(incident.triggeredAt).toLocaleString()}
										</TooltipContent>
									</Tooltip>
								</TableCell>
								<TableCell className="text-sm">
									{incident.resolvedAt
										? formatDuration(incident.timeToResolve)
										: "-"}
								</TableCell>
								<TableCell>
									<div className="flex items-center justify-end gap-1">
										<Tooltip>
											<TooltipTrigger asChild>
												<Button variant="ghost" size="icon" asChild>
													<Link to="/incidents/$id" params={{ id: incident.id }}>
														<Eye className="h-4 w-4" />
													</Link>
												</Button>
											</TooltipTrigger>
											<TooltipContent>View Details</TooltipContent>
										</Tooltip>

										{incident.status === "triggered" && onAcknowledge && (
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="ghost"
														size="icon"
														onClick={() => onAcknowledge(incident.id)}
													>
														<CheckCircle className="h-4 w-4" />
													</Button>
												</TooltipTrigger>
												<TooltipContent>Acknowledge</TooltipContent>
											</Tooltip>
										)}

										{["triggered", "investigating"].includes(incident.status) &&
											onInvestigate && (
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															variant="ghost"
															size="icon"
															onClick={() => onInvestigate(incident.id)}
														>
															<Search className="h-4 w-4" />
														</Button>
													</TooltipTrigger>
													<TooltipContent>Start Investigation</TooltipContent>
												</Tooltip>
											)}
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</TooltipProvider>
	);
}

const SKELETON_ROWS = ["row-1", "row-2", "row-3", "row-4", "row-5"];

function IncidentTableSkeleton() {
	return (
		<div className="rounded-md border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-[80px]">#</TableHead>
						<TableHead>Title</TableHead>
						<TableHead className="w-[100px]">Severity</TableHead>
						<TableHead className="w-[100px]">Priority</TableHead>
						<TableHead className="w-[120px]">Status</TableHead>
						<TableHead className="w-[120px]">Service</TableHead>
						<TableHead className="w-[80px]">Alerts</TableHead>
						<TableHead className="w-[100px]">Triggered</TableHead>
						<TableHead className="w-[100px]">TTR</TableHead>
						<TableHead className="w-[150px] text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{SKELETON_ROWS.map((rowKey) => (
						<TableRow key={rowKey}>
							<TableCell>
								<Skeleton className="h-4 w-12" />
							</TableCell>
							<TableCell>
								<Skeleton className="h-4 w-64 mb-1" />
								<Skeleton className="h-3 w-48" />
							</TableCell>
							<TableCell>
								<Skeleton className="h-5 w-16" />
							</TableCell>
							<TableCell>
								<Skeleton className="h-5 w-12" />
							</TableCell>
							<TableCell>
								<Skeleton className="h-5 w-20" />
							</TableCell>
							<TableCell>
								<Skeleton className="h-4 w-24" />
							</TableCell>
							<TableCell>
								<Skeleton className="h-4 w-8" />
							</TableCell>
							<TableCell>
								<Skeleton className="h-4 w-16" />
							</TableCell>
							<TableCell>
								<Skeleton className="h-4 w-12" />
							</TableCell>
							<TableCell>
								<div className="flex justify-end gap-1">
									<Skeleton className="h-8 w-8" />
									<Skeleton className="h-8 w-8" />
								</div>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
