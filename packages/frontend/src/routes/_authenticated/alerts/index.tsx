import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, RefreshCw } from "lucide-react";

import type { AlertStatus, Severity } from "@prismalens/contracts";

import { orpc } from "@/lib/api/orpc-client";
import { Button } from "@/components/ui/button";
import { AlertFilters, AlertsTable } from "@/components/alerts";

export const Route = createFileRoute("/_authenticated/alerts/")({
	component: AlertsPage,
});

function AlertsPage() {
	const queryClient = useQueryClient();
	const [statusFilter, setStatusFilter] = useState<AlertStatus | "all">("all");
	const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");

	// Build query params
	const queryParams = {
		...(statusFilter !== "all" && { status: statusFilter }),
		...(severityFilter !== "all" && { severity: severityFilter }),
		limit: 50,
	}

	// Fetch alerts
	const {
		data: alerts = [],
		isLoading,
		refetch,
		isRefetching,
	} = useQuery(orpc.alerts.list.queryOptions({ input: queryParams }));

	// Fetch stats
	const { data: stats } = useQuery(
		orpc.alerts.getStats.queryOptions({ input: {} })
	)

	// Acknowledge mutation
	const acknowledgeMutation = useMutation({
		...orpc.alerts.acknowledge.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["alerts"] });
		},
	})

	// Resolve mutation
	const resolveMutation = useMutation({
		...orpc.alerts.resolve.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["alerts"] });
		},
	})

	const handleAcknowledge = (alertId: string) => {
		acknowledgeMutation.mutate({ id: alertId });
	}

	const handleResolve = (alertId: string) => {
		resolveMutation.mutate({ id: alertId });
	}

	const handleClearFilters = () => {
		setStatusFilter("all");
		setSeverityFilter("all");
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<Bell className="h-8 w-8 text-primary" />
					<div>
						<h1 className="text-2xl font-bold">Alerts</h1>
						<p className="text-muted-foreground">
							{stats ? (
								<>
									{stats.total} total alerts
									{stats.byStatus?.triggered ? ` • ${stats.byStatus.triggered} triggered` : ""}
								</>
							) : (
								"Monitor and manage incoming alerts"
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
				<div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
						label="Acknowledged"
						value={stats.byStatus?.acknowledged || 0}
						className="bg-blue-500/10 text-blue-600"
					/>
					<StatCard
						label="Correlated"
						value={stats.byStatus?.correlated || 0}
						className="bg-purple-500/10 text-purple-600"
					/>
					<StatCard
						label="Resolved"
						value={stats.byStatus?.resolved || 0}
						className="bg-green-500/10 text-green-600"
					/>
				</div>
			)}

			{/* Filters */}
			<AlertFilters
				status={statusFilter}
				severity={severityFilter}
				onStatusChange={setStatusFilter}
				onSeverityChange={setSeverityFilter}
				onClear={handleClearFilters}
			/>

			{/* Table */}
			<AlertsTable
				alerts={alerts}
				isLoading={isLoading}
				onAcknowledge={handleAcknowledge}
				onResolve={handleResolve}
			/>
		</div>
	)
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
	)
}
