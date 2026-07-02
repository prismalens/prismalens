import type { AlertStatus, Severity } from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { AlertFilters, AlertsTable } from "@/components/alerts";
import { Button } from "@/components/ui/button";
import { orpc } from "@/lib/api/orpc-client";

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
	};

	// Fetch alerts
	const {
		data: alerts = [],
		isLoading,
		refetch,
		isRefetching,
	} = useQuery(orpc.alerts.list.queryOptions({ input: queryParams }));

	// Fetch stats
	const { data: stats } = useQuery(
		orpc.alerts.getStats.queryOptions({ input: {} }),
	);

	// Acknowledge mutation
	const acknowledgeMutation = useMutation({
		...orpc.alerts.acknowledge.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["alerts"] });
		},
	});

	// Resolve mutation
	const resolveMutation = useMutation({
		...orpc.alerts.resolve.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["alerts"] });
		},
	});

	const handleAcknowledge = (alertId: string) => {
		acknowledgeMutation.mutate({ id: alertId });
	};

	const handleResolve = (alertId: string) => {
		resolveMutation.mutate({ id: alertId });
	};

	const handleClearFilters = () => {
		setStatusFilter("all");
		setSeverityFilter("all");
	};

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">Alerts</h1>
					<p className="text-muted-foreground">
						Monitor and manage incoming alerts
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
			{stats && (
				<div className="flex items-center gap-6 text-sm">
					<div>
						<span className="text-muted-foreground">Total:</span>{" "}
						<span className="font-medium">{stats.total}</span>
					</div>
					<div>
						<span className="text-muted-foreground">Triggered:</span>{" "}
						<span className="font-medium">
							{stats.byStatus?.triggered || 0}
						</span>
					</div>
					<div>
						<span className="text-muted-foreground">Acknowledged:</span>{" "}
						<span className="font-medium">
							{stats.byStatus?.acknowledged || 0}
						</span>
					</div>
					<div>
						<span className="text-muted-foreground">Correlated:</span>{" "}
						<span className="font-medium">
							{stats.byStatus?.correlated || 0}
						</span>
					</div>
					<div>
						<span className="text-muted-foreground">Resolved:</span>{" "}
						<span className="font-medium">{stats.byStatus?.resolved || 0}</span>
					</div>
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
	);
}
