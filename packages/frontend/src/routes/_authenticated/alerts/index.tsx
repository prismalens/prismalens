// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AlertStatus, Severity } from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { AlertFilters, AlertsTable } from "@/components/alerts";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { orpc } from "@/lib/api/orpc-client";

type AlertsTab = "all" | "unmapped";
const ALERTS_TABS: AlertsTab[] = ["all", "unmapped"];

export const Route = createFileRoute("/_authenticated/alerts/")({
	component: AlertsPage,
	validateSearch: (search: Record<string, unknown>): { tab?: AlertsTab } => ({
		tab: (ALERTS_TABS as string[]).includes(search.tab as string)
			? (search.tab as AlertsTab)
			: "all",
	}),
});

function AlertsPage() {
	const queryClient = useQueryClient();
	const navigate = useNavigate({ from: "/alerts/" });
	const { tab = "all" } = useSearch({ from: "/_authenticated/alerts/" });
	const [statusFilter, setStatusFilter] = useState<AlertStatus | "all">("all");
	const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");

	const handleTabChange = (nextTab: string) => {
		navigate({ search: { tab: nextTab as AlertsTab }, replace: true });
	};

	// Build query params. "unmapped" mirrors the dashboard's definition of an
	// unassigned alert — hasIncident is a real, backend-filterable field
	// (AlertQuerySchema), not an invented one.
	const queryParams = {
		...(statusFilter !== "all" && { status: statusFilter }),
		...(severityFilter !== "all" && { severity: severityFilter }),
		...(tab === "unmapped" && { hasIncident: false }),
		limit: 50,
	};

	// Fetch alerts
	const {
		data: alertsResponse,
		isLoading,
		refetch,
		isRefetching,
	} = useQuery(orpc.alerts.list.queryOptions({ input: queryParams }));
	const alerts = alertsResponse?.data ?? [];

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
						<span className="font-medium" data-testid="alerts-total-count">
							{stats.total}
						</span>
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

			{/* Tabs */}
			<Tabs value={tab} onValueChange={handleTabChange}>
				<TabsList>
					<TabsTrigger value="all">All Alerts</TabsTrigger>
					<TabsTrigger value="unmapped">Unmapped</TabsTrigger>
				</TabsList>

				{/* Same panel shape for both tabs — only the query params (and thus
				 * `alerts`) differ, driven by `tab` above. Two panels (not one dynamic
				 * `value`) keep Radix's tab/tabpanel ARIA pairing correct. */}
				{ALERTS_TABS.map((tabValue) => (
					<TabsContent
						key={tabValue}
						value={tabValue}
						className="space-y-6 mt-4"
					>
						<AlertFilters
							status={statusFilter}
							severity={severityFilter}
							onStatusChange={setStatusFilter}
							onSeverityChange={setSeverityFilter}
							onClear={handleClearFilters}
						/>
						<AlertsTable
							alerts={alerts}
							isLoading={isLoading}
							onAcknowledge={handleAcknowledge}
							onResolve={handleResolve}
						/>
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}
