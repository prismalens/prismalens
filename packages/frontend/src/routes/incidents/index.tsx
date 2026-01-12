import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";

import type { IncidentStatus, Priority, Severity } from "@prismalens/contracts";

import { orpc } from "@/lib/api/orpc-client";
import { Button } from "@/components/ui/button";
import { IncidentFilters, IncidentTable } from "@/components/incidents";

export const Route = createFileRoute("/incidents/")({
	component: IncidentsPage,
});

function IncidentsPage() {
	const queryClient = useQueryClient();
	const [statusFilter, setStatusFilter] = useState<IncidentStatus | "all">("all");
	const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");
	const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");

	// Build query params
	const queryParams = {
		...(statusFilter !== "all" && { status: statusFilter }),
		...(severityFilter !== "all" && { severity: severityFilter }),
		...(priorityFilter !== "all" && { priority: priorityFilter }),
		limit: 50,
	};

	// Fetch incidents
	const {
		data: incidents = [],
		isLoading,
		refetch,
		isRefetching,
	} = useQuery(orpc.incidents.list.queryOptions({ input: queryParams }));

	// Fetch stats
	const { data: stats } = useQuery(
		orpc.incidents.getStats.queryOptions({ input: {} })
	);

	// Acknowledge mutation (updates status to investigating)
	const acknowledgeMutation = useMutation({
		...orpc.incidents.update.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["incidents"] });
		},
	});

	// Investigate mutation
	const investigateMutation = useMutation({
		...orpc.incidents.investigate.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["incidents"] });
			queryClient.invalidateQueries({ queryKey: ["investigations"] });
		},
	});

	const handleAcknowledge = (incidentId: string) => {
		acknowledgeMutation.mutate({
			id: incidentId,
			status: "investigating",
		});
	};

	const handleInvestigate = (incidentId: string) => {
		investigateMutation.mutate({ id: incidentId });
	};

	const handleClearFilters = () => {
		setStatusFilter("all");
		setSeverityFilter("all");
		setPriorityFilter("all");
	};

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<AlertTriangle className="h-8 w-8 text-primary" />
					<div>
						<h1 className="text-2xl font-bold">Incidents</h1>
						<p className="text-muted-foreground">
							{stats ? (
								<>
									{stats.total} total incidents
									{stats.active ? ` • ${stats.active} active` : ""}
								</>
							) : (
								"Manage and investigate incidents"
							)}
						</p>
					</div>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => refetch()}
					disabled={isRefetching}
				>
					<RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? "animate-spin" : ""}`} />
					Refresh
				</Button>
			</div>

			{/* Stats Cards */}
			{stats && (
				<div className="grid grid-cols-2 md:grid-cols-6 gap-4">
					<StatCard
						label="Total"
						value={stats.total}
						className="bg-muted/50"
					/>
					<StatCard
						label="Triggered"
						value={stats.byStatus?.triggered || 0}
						className="bg-red-500/10 text-red-600"
					/>
					<StatCard
						label="Investigating"
						value={stats.byStatus?.investigating || 0}
						className="bg-blue-500/10 text-blue-600"
					/>
					<StatCard
						label="Identified"
						value={stats.byStatus?.identified || 0}
						className="bg-purple-500/10 text-purple-600"
					/>
					<StatCard
						label="Monitoring"
						value={stats.byStatus?.monitoring || 0}
						className="bg-yellow-500/10 text-yellow-600"
					/>
					<StatCard
						label="Resolved"
						value={stats.byStatus?.resolved || 0}
						className="bg-green-500/10 text-green-600"
					/>
				</div>
			)}

			{/* Filters */}
			<IncidentFilters
				status={statusFilter}
				severity={severityFilter}
				priority={priorityFilter}
				onStatusChange={setStatusFilter}
				onSeverityChange={setSeverityFilter}
				onPriorityChange={setPriorityFilter}
				onClear={handleClearFilters}
			/>

			{/* Table */}
			<IncidentTable
				incidents={incidents}
				isLoading={isLoading}
				onAcknowledge={handleAcknowledge}
				onInvestigate={handleInvestigate}
			/>
		</div>
	);
}

function StatCard({
	label,
	value,
	className,
}: {
	label: string;
	value: number;
	className?: string;
}) {
	return (
		<div className={`rounded-lg p-4 ${className}`}>
			<div className="text-2xl font-bold">{value}</div>
			<div className="text-sm text-muted-foreground">{label}</div>
		</div>
	);
}
