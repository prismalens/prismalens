import { useState, useCallback } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ChevronLeft,
	ChevronRight,
	GitBranch,
	LayoutGrid,
	List,
	Plus,
	RefreshCw,
	Sparkles,
} from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import type {
	ServiceTier,
	ServiceType,
	ServiceWithRelations,
} from "@prismalens/contracts";

import { useConnections, useServices, useSuggestions } from "@/lib/api/hooks";
import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/ui/data-table";
import { DebouncedSearchInput } from "@/components/ui/debounced-search-input";
import { ServiceFormDialog } from "@/components/services/ServiceFormDialog";
import { ImportFromVcsDialog } from "@/components/services/ImportFromVcsDialog";
import { ServiceList } from "@/components/services/ServiceList";

const PAGE_SIZE = 25;

const serviceTypes: { value: ServiceType | "all"; label: string }[] = [
	{ value: "all", label: "All Types" },
	{ value: "service", label: "Service" },
	{ value: "database", label: "Database" },
	{ value: "queue", label: "Queue" },
	{ value: "cache", label: "Cache" },
	{ value: "gateway", label: "Gateway" },
	{ value: "external", label: "External" },
	{ value: "infrastructure", label: "Infrastructure" },
];

const serviceTiers: { value: ServiceTier | "all"; label: string }[] = [
	{ value: "all", label: "All Tiers" },
	{ value: "tier_1", label: "Tier 1 - Critical" },
	{ value: "tier_2", label: "Tier 2 - High" },
	{ value: "tier_3", label: "Tier 3 - Medium" },
	{ value: "tier_4", label: "Tier 4 - Low" },
];

const tierLabels: Record<string, string> = {
	tier_1: "Critical",
	tier_2: "High",
	tier_3: "Medium",
	tier_4: "Low",
};

type ServicesSearch = {
	type?: string;
	tier?: string;
	search?: string;
	page?: number;
	view?: "table" | "grid";
};

export const Route = createFileRoute("/_authenticated/services/")({
	validateSearch: (raw: Record<string, unknown>): ServicesSearch => ({
		type: typeof raw.type === "string" ? raw.type : undefined,
		tier: typeof raw.tier === "string" ? raw.tier : undefined,
		search: typeof raw.search === "string" ? raw.search : undefined,
		page: typeof raw.page === "number" ? raw.page : 1,
		view:
			raw.view === "grid" || raw.view === "table"
				? raw.view
				: "table",
	}),
	component: ServicesPage,
});

const columns: ColumnDef<ServiceWithRelations>[] = [
	{
		accessorKey: "name",
		header: "Name",
		cell: ({ row }) => {
			const s = row.original;
			return (
				<Link
					to="/services/$id"
					params={{ id: s.id }}
					search={{ tab: "general" }}
					className="hover:text-primary"
				>
					<div>
						<p className="font-medium">
							{s.displayName || s.name}
						</p>
						{s.displayName && (
							<p className="text-xs text-muted-foreground font-mono">
								{s.name}
							</p>
						)}
					</div>
				</Link>
			);
		},
	},
	{
		accessorKey: "type",
		header: "Type",
		cell: ({ row }) => (
			<Badge variant="outline" className="capitalize">
				{row.original.type}
			</Badge>
		),
	},
	{
		accessorKey: "tier",
		header: "Tier",
		cell: ({ row }) => (
			<Badge variant="secondary">
				{tierLabels[row.original.tier] || row.original.tier}
			</Badge>
		),
	},
	{
		accessorKey: "team",
		header: "Team",
		cell: ({ row }) => (
			<span className="text-muted-foreground">
				{row.original.team || "—"}
			</span>
		),
	},
	{
		accessorKey: "alertCount",
		header: "Alerts",
		cell: ({ row }) => row.original.alertCount ?? 0,
	},
	{
		accessorKey: "incidentCount",
		header: "Incidents",
		cell: ({ row }) => row.original.incidentCount ?? 0,
	},
];

function ServicesPage() {
	const searchParams = Route.useSearch();
	const navigate = useNavigate({ from: "/services" });
	const [showAddDialog, setShowAddDialog] = useState(false);
	const [showImportDialog, setShowImportDialog] = useState(false);

	const typeFilter = (searchParams.type || "all") as ServiceType | "all";
	const tierFilter = (searchParams.tier || "all") as ServiceTier | "all";
	const currentPage = searchParams.page ?? 1;
	const view = searchParams.view ?? "table";
	const offset = (currentPage - 1) * PAGE_SIZE;

	// Navigate helper
	const updateSearch = useCallback(
		(updates: Partial<ServicesSearch>) => {
			navigate({
				search: (prev: ServicesSearch) => ({
					...prev,
					...updates,
				}),
			});
		},
		[navigate],
	);

	// Debounced search
	const handleSearchChange = useCallback(
		(value: string) => {
			updateSearch({ search: value || undefined, page: 1 });
		},
		[updateSearch],
	);

	// Detect VCS connections for import button
	const { data: allConnections = [] } = useConnections();
	const hasVcsConnections = allConnections.some((c) =>
		["github", "gitlab", "bitbucket"].some((prefix) =>
			(c.integration?.templateId ?? "").startsWith(prefix),
		),
	);

	// Pending suggestions count
	const { data: pendingSuggestions } = useSuggestions({ status: "pending" });
	const pendingCount = Array.isArray(pendingSuggestions)
		? pendingSuggestions.length
		: 0;

	// Fetch services with server-side filtering
	const {
		data: response,
		isLoading,
		refetch,
		isRefetching,
	} = useServices({
		limit: PAGE_SIZE,
		offset,
		type: typeFilter !== "all" ? typeFilter : undefined,
		tier: tierFilter !== "all" ? tierFilter : undefined,
		search: searchParams.search || undefined,
	});

	const services = response?.data ?? [];
	const total = response?.total ?? 0;
	const totalPages = Math.ceil(total / PAGE_SIZE);
	const showingFrom = total > 0 ? offset + 1 : 0;
	const showingTo = Math.min(offset + PAGE_SIZE, total);

	const hasFilters =
		typeFilter !== "all" || tierFilter !== "all" || !!searchParams.search;

	const handleClearFilters = () => {
		updateSearch({
			type: undefined,
			tier: undefined,
			search: undefined,
			page: 1,
		});
	};

	return (
		<div className="space-y-6">
			<PageHeader
				title="Services"
				subtitle={`${total} services in catalog`}
				actions={
					<>
						<Button
							variant="outline"
							size="sm"
							onClick={() => refetch()}
							disabled={isRefetching}
						>
							<RefreshCw
								className={`h-4 w-4 mr-1 ${isRefetching ? "animate-spin" : ""}`}
							/>
							Refresh
						</Button>
						{pendingCount > 0 && (
							<Button variant="outline" size="sm" asChild>
								<Link to="/services/discovery">
									<Sparkles className="h-4 w-4 mr-1" />
									Discovered
									<Badge variant="secondary" className="ml-1 text-xs">
										{pendingCount}
									</Badge>
								</Link>
							</Button>
						)}
						{hasVcsConnections && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => setShowImportDialog(true)}
							>
								<GitBranch className="h-4 w-4 mr-1" />
								Import from VCS
							</Button>
						)}
						<Button size="sm" onClick={() => setShowAddDialog(true)}>
							<Plus className="h-4 w-4 mr-1" />
							Add Service
						</Button>
					</>
				}
			/>

			{/* Filters */}
			<div className="flex flex-wrap items-center gap-3">
				<DebouncedSearchInput
					value={searchParams.search ?? ""}
					onValueChange={handleSearchChange}
					placeholder="Search services..."
					className="w-[220px]"
				/>

				<Select
					value={typeFilter}
					onValueChange={(value) =>
						updateSearch({
							type: value === "all" ? undefined : value,
							page: 1,
						})
					}
				>
					<SelectTrigger className="w-[160px]">
						<SelectValue placeholder="Filter by type" />
					</SelectTrigger>
					<SelectContent>
						{serviceTypes.map((type) => (
							<SelectItem key={type.value} value={type.value}>
								{type.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Select
					value={tierFilter}
					onValueChange={(value) =>
						updateSearch({
							tier: value === "all" ? undefined : value,
							page: 1,
						})
					}
				>
					<SelectTrigger className="w-[180px]">
						<SelectValue placeholder="Filter by tier" />
					</SelectTrigger>
					<SelectContent>
						{serviceTiers.map((tier) => (
							<SelectItem key={tier.value} value={tier.value}>
								{tier.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{hasFilters && (
					<Button variant="ghost" size="sm" onClick={handleClearFilters}>
						Clear filters
					</Button>
				)}

				<div className="ml-auto flex items-center gap-1">
					<Button
						variant={view === "table" ? "secondary" : "ghost"}
						size="sm"
						className="h-8 w-8 p-0"
						onClick={() => updateSearch({ view: "table" })}
					>
						<List className="h-4 w-4" />
					</Button>
					<Button
						variant={view === "grid" ? "secondary" : "ghost"}
						size="sm"
						className="h-8 w-8 p-0"
						onClick={() => updateSearch({ view: "grid" })}
					>
						<LayoutGrid className="h-4 w-4" />
					</Button>
				</div>
			</div>

			{/* Content */}
			{view === "table" ? (
				<DataTable
					columns={columns}
					data={services}
					isLoading={isLoading}
					emptyMessage="No services found"
					onRowClick={(row) =>
						navigate({ to: "/services/$id", params: { id: row.id }, search: { tab: "general" } })
					}
				/>
			) : (
				<ServiceList services={services} isLoading={isLoading} />
			)}

			{/* Pagination */}
			{total > PAGE_SIZE && (
				<div className="flex items-center justify-between">
					<p className="text-sm text-muted-foreground">
						Showing {showingFrom}–{showingTo} of {total} services
					</p>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={currentPage <= 1}
							onClick={() => updateSearch({ page: currentPage - 1 })}
						>
							<ChevronLeft className="h-4 w-4 mr-1" />
							Previous
						</Button>
						<span className="text-sm text-muted-foreground">
							Page {currentPage} of {totalPages}
						</span>
						<Button
							variant="outline"
							size="sm"
							disabled={currentPage >= totalPages}
							onClick={() => updateSearch({ page: currentPage + 1 })}
						>
							Next
							<ChevronRight className="h-4 w-4 ml-1" />
						</Button>
					</div>
				</div>
			)}

			{/* Dialogs */}
			<ServiceFormDialog
				open={showAddDialog}
				onOpenChange={setShowAddDialog}
				onSuccess={() => refetch()}
			/>
			<ImportFromVcsDialog
				open={showImportDialog}
				onOpenChange={setShowImportDialog}
				onSuccess={() => refetch()}
			/>
		</div>
	);
}
