import type { AlertWithRelations } from "@prismalens/contracts";

import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCircle, ExternalLink, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";

export interface AlertsTableProps {
	alerts: AlertWithRelations[];
	isLoading?: boolean;
	onAcknowledge?: (alertId: string) => void;
	onResolve?: (alertId: string) => void;
}

function LoadingSkeleton() {
	return (
		<>
			{[...Array(5)].map((_, i) => (
				<TableRow key={i}>
					<TableCell><Skeleton className="h-4 w-[200px]" /></TableCell>
					<TableCell><Skeleton className="h-6 w-[80px]" /></TableCell>
					<TableCell><Skeleton className="h-6 w-[100px]" /></TableCell>
					<TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
					<TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
					<TableCell><Skeleton className="h-8 w-[120px]" /></TableCell>
				</TableRow>
			))}
		</>
	);
}

function AlertsEmptyState() {
	return (
		<EmptyState
			variant="table-cell"
			colSpan={6}
			icon={Bell}
			title="No alerts found"
			description="Alerts will appear here when received from your monitoring tools"
		/>
	);
}

export function AlertsTable({
	alerts,
	isLoading,
	onAcknowledge,
	onResolve,
}: AlertsTableProps) {
	return (
		<TooltipProvider>
			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-[300px]">Alert</TableHead>
							<TableHead>Severity</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Service</TableHead>
							<TableHead>Time</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							<LoadingSkeleton />
						) : alerts.length === 0 ? (
							<AlertsEmptyState />
						) : (
							alerts.map((alert) => (
								<TableRow key={alert.id}>
									<TableCell className="font-medium">
										<div className="flex flex-col gap-1">
											<span className="truncate max-w-[280px]" title={alert.title}>
												{alert.title}
											</span>
											{alert.incident && (
												<Link
													to="/incidents/$id"
													params={{ id: alert.incident.id }}
													className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
												>
													<ExternalLink className="h-3 w-3" />
													INC-{alert.incident.number}
												</Link>
											)}
										</div>
									</TableCell>
									<TableCell>
										<SeverityBadge severity={alert.severity} />
									</TableCell>
									<TableCell>
										<StatusBadge status={alert.status} />
									</TableCell>
									<TableCell>
										{alert.service ? (
											<Link
												to="/services/$id"
												params={{ id: alert.service.id }}
												search={{ tab: "general" }}
												className="text-sm hover:text-primary"
											>
												{alert.service.displayName || alert.service.name}
											</Link>
										) : (
											<span className="text-muted-foreground text-sm">—</span>
										)}
									</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										<Tooltip>
											<TooltipTrigger>
												{formatDistanceToNow(new Date(alert.triggeredAt), { addSuffix: true })}
											</TooltipTrigger>
											<TooltipContent>
												{new Date(alert.triggeredAt).toLocaleString()}
											</TooltipContent>
										</Tooltip>
									</TableCell>
									<TableCell className="text-right">
										<div className="flex items-center justify-end gap-2">
											{alert.status === "triggered" && onAcknowledge && (
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															variant="outline"
															size="sm"
															onClick={() => onAcknowledge(alert.id)}
														>
															<Eye className="h-4 w-4" />
														</Button>
													</TooltipTrigger>
													<TooltipContent>Acknowledge</TooltipContent>
												</Tooltip>
											)}
											{(alert.status === "triggered" || alert.status === "acknowledged") && onResolve && (
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															variant="outline"
															size="sm"
															onClick={() => onResolve(alert.id)}
														>
															<CheckCircle className="h-4 w-4" />
														</Button>
													</TooltipTrigger>
													<TooltipContent>Resolve</TooltipContent>
												</Tooltip>
											)}
											{alert.incident && (
												<Tooltip>
													<TooltipTrigger asChild>
														<Button variant="outline" size="sm" asChild>
															<Link to="/incidents/$id" params={{ id: alert.incident.id }}>
																<ExternalLink className="h-4 w-4" />
															</Link>
														</Button>
													</TooltipTrigger>
													<TooltipContent>View Incident</TooltipContent>
												</Tooltip>
											)}
										</div>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>
		</TooltipProvider>
	);
}
