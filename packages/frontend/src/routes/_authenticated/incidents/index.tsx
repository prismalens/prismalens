// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Incidents Page
 *
 * List all incidents with tabbed interface (List | Analytics),
 * date range filtering, and TanStack Table.
 */

import {
	type IncidentStatus,
	isIncidentOpen,
	type Priority,
	type Severity,
} from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { BarChart3, List, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { DateRangeValue } from "@/components/incidents";
import {
	CreateIncidentDialog,
	DateRangeFilter,
	IncidentAnalytics,
	IncidentDataTable,
	IncidentFilters,
	QueueStats,
} from "@/components/incidents";
import { TelemetryConsent } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useInvestigationReadiness } from "@/lib/api/hooks";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import { investigationKeys } from "@/lib/api/hooks/use-investigations-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";

// Search params type
interface IncidentSearchParams {
	tab?: "list" | "analytics";
	/** `1` narrows the list to open incidents (the "Open" slot). */
	open?: string;
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
		open: search.open === "1" ? "1" : undefined,
		status: search.status as string | undefined,
		severity: search.severity as string | undefined,
		priority: search.priority as string | undefined,
		from: search.from as string | undefined,
		to: search.to as string | undefined,
	}),
});

function IncidentsPage() {
	const queryClient = useQueryClient();
	const navigate = useNavigate({ from: "/incidents/" });
	const searchParams = useSearch({ from: "/_authenticated/incidents/" });
	const { toast } = useToast();

	// Would an investigation actually start? Server's gate, not a local guess (#521).
	const { isReady: canRunInvestigation, blockedReason } =
		useInvestigationReadiness();
	const investigateDisabled = !canRunInvestigation;
	const investigateDisabledReason = blockedReason;

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

	// Manual authorship (C10) — create an incident without an alert source
	const [isCreateOpen, setIsCreateOpen] = useState(false);

	// Current tab
	const currentTab = searchParams.tab || "list";

	const openFilter = searchParams.open === "1";

	// Build query params for API
	const queryParams = useMemo(
		() => ({
			...(statusFilter !== "all" && { status: statusFilter }),
			...(openFilter && statusFilter === "all" && { open: true }),
			...(severityFilter !== "all" && { severity: severityFilter }),
			...(priorityFilter !== "all" && { priority: priorityFilter }),
			...(dateRange.from && { fromDate: dateRange.from }),
			...(dateRange.to && { toDate: dateRange.to }),
			limit: 100,
		}),
		[statusFilter, severityFilter, priorityFilter, dateRange, openFilter],
	);

	// Fetch incidents
	const { data: incidentsResponse, isLoading } = useQuery(
		orpc.incidents.list.queryOptions({ input: queryParams }),
	);
	const incidents = incidentsResponse?.data ?? [];

	// The numbers come from the whole window, never from the page of rows.
	const statsQuery = useQuery({
		...orpc.incidents.getStats.queryOptions({
			input: {
				...(dateRange.from && { fromDate: dateRange.from }),
				...(dateRange.to && { toDate: dateRange.to }),
			},
		}),
		refetchInterval: 30_000,
	});
	const statsWindow =
		dateRange.from && dateRange.to
			? `${dateRange.from.toLocaleDateString()} – ${dateRange.to.toLocaleDateString()}`
			: dateRange.from
				? `since ${dateRange.from.toLocaleDateString()}`
				: "all time";

	// Acknowledge mutation (updates status to investigating)
	const acknowledgeMutation = useMutation({
		...orpc.incidents.update.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: incidentKeys.all() });
		},
	});

	// Investigate mutation
	const investigateMutation = useMutation({
		...orpc.incidents.investigate.mutationOptions(),
		onSuccess: (data, variables) => {
			queryClient.invalidateQueries({ queryKey: incidentKeys.all() });
			queryClient.invalidateQueries({ queryKey: investigationKeys.all() });
			navigate({
				to: "/incidents/$id",
				params: { id: variables.id },
				search: data?.investigationId
					? { investigation: data.investigationId }
					: {},
			});
		},
		onError: (error) => {
			toast({
				title: "Investigation refused",
				description: getErrorMessage(error),
				variant: "destructive",
			});
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

	// Land on the new incident: its detail page is where the next step of the
	// journey (Start Investigation) lives.
	const handleIncidentCreated = (incidentId: string) => {
		navigate({ to: "/incidents/$id", params: { id: incidentId } });
	};

	const handleClearFilters = () => {
		setStatusFilter("all");
		setSeverityFilter("all");
		setPriorityFilter("all");
		updateSearchParams({
			status: undefined,
			severity: undefined,
			priority: undefined,
		});
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

	const handleToggleOpen = () => {
		setStatusFilter("all");
		updateSearchParams({
			open: openFilter ? undefined : "1",
			status: undefined,
		});
	};

	const handleSeverityFromStats = (severity: string | undefined) => {
		setSeverityFilter((severity as Severity | "all") || "all");
		updateSearchParams({ severity });
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

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-xl font-semibold">Incidents</h1>
				<Button
					size="sm"
					onClick={() => setIsCreateOpen(true)}
					data-testid="create-incident-button"
				>
					<Plus className="mr-2 h-4 w-4" />
					Create Incident
				</Button>
			</div>

			<TelemetryConsent />

			<CreateIncidentDialog
				open={isCreateOpen}
				onOpenChange={setIsCreateOpen}
				onCreated={handleIncidentCreated}
			/>

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

					<QueueStats
						stats={statsQuery.data}
						isLoading={statsQuery.isLoading}
						error={statsQuery.error}
						updatedAt={statsQuery.dataUpdatedAt}
						onRetry={() => statsQuery.refetch()}
						window={statsWindow}
						openFilter={openFilter}
						onToggleOpen={handleToggleOpen}
						severityFilter={
							severityFilter !== "all" ? severityFilter : undefined
						}
						onSeverity={handleSeverityFromStats}
					/>

					{/* Data Table */}
					<IncidentDataTable
						incidents={incidents}
						isLoading={isLoading}
						onAcknowledge={handleAcknowledge}
						onInvestigate={handleInvestigate}
						onOpen={(id) => navigate({ to: "/incidents/$id", params: { id } })}
						onCreate={() => setIsCreateOpen(true)}
						investigateDisabled={investigateDisabled}
						investigateDisabledReason={investigateDisabledReason}
					/>
				</TabsContent>

				{/* Analytics Tab */}
				<TabsContent value="analytics" className="mt-4">
					<IncidentAnalytics
						incidents={incidents}
						days={
							dateRange.from && dateRange.to
								? Math.ceil(
										(dateRange.to.getTime() - dateRange.from.getTime()) /
											(1000 * 60 * 60 * 24),
									)
								: 30
						}
						onSeverityFilter={(severity) => {
							setSeverityFilter(severity as Severity);
							handleTabChange("list");
						}}
						onServiceFilter={(serviceId) => {
							// Navigate to service detail page
							navigate({
								to: "/services/$id",
								params: { id: serviceId },
								search: { tab: "overview" },
							});
						}}
					/>
				</TabsContent>
			</Tabs>
		</div>
	);
}
