// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AlertStatus, Severity } from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { CloudDownload, RefreshCw } from "lucide-react";
import { useState } from "react";
import { AlertFilters, AlertsTable } from "@/components/alerts";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { alertKeys } from "@/lib/api/hooks/use-alerts-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";

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
	const { toast } = useToast();
	const [statusFilter, setStatusFilter] = useState<AlertStatus | "all">("all");
	const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");

	const handleTabChange = (nextTab: string) => {
		navigate({ search: { tab: nextTab as AlertsTab }, replace: true });
	};

	// `unassigned` filters server-side, so `limit` windows the unassigned set
	// itself; a browser-side predicate would window all statuses first.
	const queryParams = {
		...(statusFilter !== "all" && { status: statusFilter }),
		...(severityFilter !== "all" && { severity: severityFilter }),
		...(tab === "unmapped" && { unassigned: true }),
		limit: 100,
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
			queryClient.invalidateQueries({ queryKey: alertKeys.all() });
		},
	});

	// Resolve mutation
	const resolveMutation = useMutation({
		...orpc.alerts.resolve.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: alertKeys.all() });
		},
	});

	// Pull mutation: fetch firing alerts from Alertmanager, catch up from Prometheus (#605)
	const pullMutation = useMutation({
		...orpc.alerts.pull.mutationOptions(),
		onSuccess: (result) => {
			if (result.errors.length > 0 && result.sources === 0) {
				toast({
					title: "Pull failed",
					description: (
						<ul className="list-disc pl-4">
							{result.errors.map((error) => (
								<li key={error}>{error}</li>
							))}
						</ul>
					),
					variant: "destructive",
				});
				return;
			}
			if (result.sources === 0) {
				toast({
					title: "No Alertmanager or Prometheus connection is configured",
					description: (
						<Link to="/settings" search={{ tab: "integrations" }}>
							Add a connection under Settings → Integrations
						</Link>
					),
				});
				return;
			}
			const totalPulled = result.received + result.caughtUp;
			toast({
				title: `Pulled ${totalPulled} alerts, ${result.processed} new, ${result.caughtUp} caught up`,
				description:
					result.errors.length > 0 ? (
						<ul className="list-disc pl-4">
							{result.errors.map((error) => (
								<li key={error}>{error}</li>
							))}
						</ul>
					) : undefined,
				variant: result.errors.length > 0 ? "destructive" : undefined,
			});
			queryClient.invalidateQueries({ queryKey: alertKeys.all() });
		},
		onError: (error) => {
			toast({
				title: "Pull failed",
				description: getErrorMessage(error),
				variant: "destructive",
			});
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
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						data-testid="alerts-pull"
						onClick={() => pullMutation.mutate({})}
						disabled={pullMutation.isPending}
					>
						<CloudDownload
							className={`h-4 w-4 mr-2 ${pullMutation.isPending ? "animate-pulse" : ""}`}
						/>
						Pull from Alertmanager
					</Button>
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
