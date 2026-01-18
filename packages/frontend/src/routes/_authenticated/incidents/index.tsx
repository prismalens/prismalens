/**
 * Incidents Page
 *
 * List all incidents with tabbed interface (List | Analytics),
 * date range filtering, and TanStack Table.
 */

import { useState, useMemo } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, BarChart3, List } from "lucide-react";

import type { IncidentStatus, Priority, Severity } from "@prismalens/contracts";

import { orpc } from "@/lib/api/orpc-client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	IncidentFilters,
	IncidentDataTable,
	DateRangeFilter,
	IncidentStatsBar,
	IncidentAnalytics,
} from "@/components/incidents";
import type { DateRangeValue } from "@/components/incidents";

// Search params type
interface IncidentSearchParams {
	tab?: "list" | "analytics";
	status?: string;
	severity?: string;
	priority?: string;
	from?: string;
	to?: string;
}

export const Route = createFileRoute("/_authenticated/incidents/")({
	component: IncidentsPage,
	validateSearch: (search: Record<string, unknown>): IncidentSearchParams => ({
		tab: (search.tab as "list" | "analytics") || "list",
		status: search.status as string | undefined,
		severity: search.severity as string | undefined,
		priority: search.priority as string | undefined,
		from: search.from as string | undefined,
		to: search.to as string | undefined,
	}),
});

function IncidentsPage() {
	const queryClient = useQueryClient();
	const navigate = useNavigate({ from: "/incidents" });
	const searchParams = useSearch({ from: "/_authenticated/incidents/" });

	// Local state for filters
	const [statusFilter, setStatusFilter] = useState<IncidentStatus | "all">(
		(searchParams.status as IncidentStatus) || "all",
	);
	const [severityFilter, setSeverityFilter] = useState<Severity | "all">(
		(searchParams.severity as Severity) || "all",
	);
	const [priorityFilter, setPriorityFilter] = useState<Priority | "all">(
		(searchParams.priority as Priority) || "all",
	);

	// Date range state
	const [dateRange, setDateRange] = useState<DateRangeValue>({
		from: searchParams.from ? new Date(searchParams.from) : undefined,
		to: searchParams.to ? new Date(searchParams.to) : undefined,
	});

	// Current tab
	const currentTab = searchParams.tab || "list";

	// Build query params for API
	const queryParams = useMemo(
		() => ({
			...(statusFilter !== "all" && { status: statusFilter }),
			...(severityFilter !== "all" && { severity: severityFilter }),
			...(priorityFilter !== "all" && { priority: priorityFilter }),
			...(dateRange.from && { fromDate: dateRange.from }),
			...(dateRange.to && { toDate: dateRange.to }),
			limit: 100,
		}),
		[statusFilter, severityFilter, priorityFilter, dateRange],
	);

	// Fetch incidents
	const {
		data: incidents = [],
		isLoading,
		refetch,
		isRefetching,
	} = useQuery(orpc.incidents.list.queryOptions({ input: queryParams }));

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
		updateSearchParams({ status: undefined, severity: undefined, priority: undefined });
	};

	const handleDateRangeChange = (value: DateRangeValue) => {
		setDateRange(value);
		updateSearchParams({
			from: value.from?.toISOString(),
			to: value.to?.toISOString(),
		});
	};

	const handleTabChange = (tab: string) => {
		updateSearchParams({ tab: tab as "list" | "analytics" });
	};

	// Handle filter changes from stats bar
	const handleStatusFilterFromStats = (status: string | undefined) => {
		if (status === "active") {
			// "Active" means not resolved or closed - we'll handle this client-side
			setStatusFilter("all");
		} else {
			setStatusFilter(status as IncidentStatus | "all" || "all");
		}
	};

	const handleSeverityFilterFromStats = (severity: string | undefined) => {
		setSeverityFilter(severity as Severity | "all" || "all");
	};

	// Update URL search params
	const updateSearchParams = (params: Partial<IncidentSearchParams>) => {
		navigate({
			search: (prev: IncidentSearchParams) => ({
				...prev,
				...params,
			}),
			replace: true,
		});
	};

	// Calculate active count for header
	const activeCount = incidents.filter(
		(i) => !["resolved", "closed"].includes(i.status),
	).length;

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<AlertTriangle className="h-8 w-8 text-primary" />
					<div>
						<h1 className="text-2xl font-bold">Incidents</h1>
						<p className="text-muted-foreground">
							{incidents.length} incidents
							{activeCount > 0 && ` • ${activeCount} active`}
						</p>
					</div>
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

			{/* Tabs */}
			<Tabs value={currentTab} onValueChange={handleTabChange}>
				<TabsList>
					<TabsTrigger value="list" className="flex items-center gap-2">
						<List className="h-4 w-4" />
						List
					</TabsTrigger>
					<TabsTrigger value="analytics" className="flex items-center gap-2">
						<BarChart3 className="h-4 w-4" />
						Analytics
					</TabsTrigger>
				</TabsList>

				{/* List Tab */}
				<TabsContent value="list" className="space-y-4 mt-4">
					{/* Date Range Filter */}
					<DateRangeFilter value={dateRange} onChange={handleDateRangeChange} />

					{/* Existing Filters */}
					<IncidentFilters
						status={statusFilter}
						severity={severityFilter}
						priority={priorityFilter}
						onStatusChange={setStatusFilter}
						onSeverityChange={setSeverityFilter}
						onPriorityChange={setPriorityFilter}
						onClear={handleClearFilters}
					/>

					{/* Stats Bar */}
					<IncidentStatsBar
						incidents={incidents}
						onFilterStatus={handleStatusFilterFromStats}
						onFilterSeverity={handleSeverityFilterFromStats}
						activeStatusFilter={statusFilter !== "all" ? statusFilter : undefined}
						activeSeverityFilter={
							severityFilter !== "all" ? severityFilter : undefined
						}
					/>

					{/* Data Table */}
					<IncidentDataTable
						incidents={incidents}
						isLoading={isLoading}
						onAcknowledge={handleAcknowledge}
						onInvestigate={handleInvestigate}
					/>
				</TabsContent>

				{/* Analytics Tab */}
				<TabsContent value="analytics" className="mt-4">
					<IncidentAnalytics
						incidents={incidents}
						days={dateRange.from && dateRange.to
							? Math.ceil((dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24))
							: 30
						}
						onSeverityFilter={(severity) => {
							setSeverityFilter(severity as Severity);
							handleTabChange("list");
						}}
						onServiceFilter={(serviceId) => {
							// Navigate to service detail page
							navigate({ to: "/services/$id", params: { id: serviceId } });
						}}
					/>
				</TabsContent>
			</Tabs>
		</div>
	);
}
