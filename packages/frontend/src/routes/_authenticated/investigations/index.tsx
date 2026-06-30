import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	AlertCircle,
	CheckCircle,
	Clock,
	RefreshCw,
	Search,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import type { WorkflowStatus } from "@prismalens/contracts";

import { orpc } from "@/lib/api/orpc-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/investigations/")({
	component: InvestigationsPage,
});

const workflowStatuses: { value: WorkflowStatus | "all"; label: string }[] = [
	{ value: "all", label: "All Statuses" },
	{ value: "pending", label: "Pending" },
	{ value: "running", label: "Running" },
	{ value: "completed", label: "Completed" },
	{ value: "failed", label: "Failed" },
];

function InvestigationsPage() {
	const [statusFilter, setStatusFilter] = useState<WorkflowStatus | "all">(
		"all",
	)

	// Build query params
	const queryParams: { status?: WorkflowStatus; limit: number } = {
		limit: 50,
	}
	if (statusFilter !== "all") {
		queryParams.status = statusFilter;
	}

	// Fetch investigations
	const {
		data: investigations = [],
		isLoading,
		refetch,
		isRefetching,
	} = useQuery(orpc.investigations.list.queryOptions({ input: queryParams }));

	const handleClearFilters = () => {
		setStatusFilter("all");
	}

	const hasFilters = statusFilter !== "all";

	// Calculate stats
	const stats = {
		total: investigations.length,
		running: investigations.filter((i) => i.status === "running").length,
		completed: investigations.filter((i) => i.status === "completed").length,
		failed: investigations.filter((i) => i.status === "failed").length,
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">Investigations</h1>
					<p className="text-muted-foreground">
						{investigations.length} investigations
						{hasFilters && ` (filtered)`}
					</p>
				</div>
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
			</div>

			{/* Stats Summary */}
			{!isLoading && investigations.length > 0 && (
				<div className="flex items-center gap-6 text-sm">
					<div>
						<span className="text-muted-foreground">Total:</span>{" "}
						<span className="font-medium">{stats.total}</span>
					</div>
					<div>
						<span className="text-muted-foreground">Running:</span>{" "}
						<span className="font-medium">{stats.running}</span>
					</div>
					<div>
						<span className="text-muted-foreground">Completed:</span>{" "}
						<span className="font-medium">{stats.completed}</span>
					</div>
					<div>
						<span className="text-muted-foreground">Failed:</span>{" "}
						<span className="font-medium">{stats.failed}</span>
					</div>
				</div>
			)}

			{/* Filters */}
			<div className="flex flex-wrap items-center gap-3">
				<Select
					value={statusFilter}
					onValueChange={(value) =>
						setStatusFilter(value as WorkflowStatus | "all")
					}
				>
					<SelectTrigger className="w-[160px]">
						<SelectValue placeholder="Filter by status" />
					</SelectTrigger>
					<SelectContent>
						{workflowStatuses.map((status) => (
							<SelectItem key={status.value} value={status.value}>
								{status.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{hasFilters && (
					<Button variant="ghost" size="sm" onClick={handleClearFilters}>
						Clear filters
					</Button>
				)}
			</div>

			{/* Investigations Table */}
			{isLoading ? (
				<InvestigationsTableSkeleton />
			) : investigations.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-12">
						<Search className="h-6 w-6 mb-4 text-muted-foreground" />
						<p className="text-lg font-medium text-muted-foreground">
							No investigations found
						</p>
						<p className="text-sm text-muted-foreground">
							Investigations will appear here when incidents are investigated
						</p>
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardContent className="p-0">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>ID</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Root Cause</TableHead>
									<TableHead>Agents</TableHead>
									<TableHead>Started</TableHead>
									<TableHead>Duration</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{investigations.map((investigation) => (
									<TableRow key={investigation.id} className="cursor-pointer">
										<TableCell>
											<Link
												to="/investigations/$id"
												params={{ id: investigation.id }}
												className="text-primary hover:text-primary/80 font-mono text-sm"
											>
												{investigation.id.slice(0, 8)}...
											</Link>
										</TableCell>
										<TableCell>
											<StatusBadge status={investigation.status} />
										</TableCell>
										<TableCell>
											<span className="text-sm line-clamp-1 max-w-[200px]">
												{investigation.rootCause || "-"}
											</span>
										</TableCell>
										<TableCell>
											<span className="text-sm text-muted-foreground">
												{investigation.agentExecutions?.length ?? 0}
											</span>
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											{investigation.startedAt
												? formatDistanceToNow(new Date(investigation.startedAt), {
														addSuffix: true,
													})
												: "-"}
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											{investigation.startedAt && investigation.completedAt
												? calculateDuration(
														investigation.startedAt,
														investigation.completedAt,
													)
												: investigation.status === "running"
													? "In progress..."
													: "-"}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			)}
		</div>
	)
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
	}

	const config =
		statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
	const Icon = config.icon;

	return (
		<Badge variant={config.variant} className={config.className}>
			<Icon className="w-3 h-3 mr-1" />
			{status}
		</Badge>
	)
}

function calculateDuration(start: string, end: string): string {
	const startDate = new Date(start);
	const endDate = new Date(end);
	const diffMs = endDate.getTime() - startDate.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffSecs = Math.floor((diffMs % 60000) / 1000);
	if (diffMins > 0) {
		return `${diffMins}m ${diffSecs}s`;
	}
	return `${diffSecs}s`;
}

function InvestigationsTableSkeleton() {
	const skeletonIds = ["skel-1", "skel-2", "skel-3", "skel-4", "skel-5"];

	return (
		<Card>
			<CardContent className="p-0">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>ID</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Root Cause</TableHead>
							<TableHead>Agents</TableHead>
							<TableHead>Started</TableHead>
							<TableHead>Duration</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{skeletonIds.map((id) => (
							<TableRow key={id}>
								<TableCell>
									<Skeleton className="h-4 w-20" />
								</TableCell>
								<TableCell>
									<Skeleton className="h-5 w-20" />
								</TableCell>
								<TableCell>
									<Skeleton className="h-4 w-32" />
								</TableCell>
								<TableCell>
									<Skeleton className="h-4 w-8" />
								</TableCell>
								<TableCell>
									<Skeleton className="h-4 w-24" />
								</TableCell>
								<TableCell>
									<Skeleton className="h-4 w-16" />
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	)
}
