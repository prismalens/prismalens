// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	ServiceTier,
	ServiceType,
	ServiceWithRelations,
} from "@prismalens/contracts";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
	ChevronLeft,
	ChevronRight,
	LayoutGrid,
	List,
	Loader2,
	Plus,
	RefreshCw,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { ServiceFormDialog } from "@/components/services/ServiceFormDialog";
import { ServiceList } from "@/components/services/ServiceList";
import { tierLabels } from "@/components/services/service-detail.utils";
import { SettingsFrame } from "@/components/settings/SettingsFrame";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Mono } from "@/components/shared/Mono";
import { RecordSection } from "@/components/shared/RecordSection";
import { type ChipTone, StateChip } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { DebouncedSearchInput } from "@/components/ui/debounced-search-input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	useBatchCreateRepositories,
	useConnections,
	useCreateService,
	useDeleteRepository,
	useLinkRepository,
	useRepositories,
	useServices,
	useServiceTeams,
} from "@/lib/api/hooks";
import { client } from "@/lib/api/orpc-client";
import { cn } from "@/lib/utils";

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

const tierTones: Record<string, ChipTone> = {
	tier_1: "critical",
	tier_2: "high",
	tier_3: "medium",
	tier_4: "neutral",
};

type ServicesSearch = {
	type?: string;
	tier?: string;
	team?: string;
	search?: string;
	page?: number;
	view?: "table" | "grid";
};

export const Route = createFileRoute("/_authenticated/services/")({
	validateSearch: (raw: Record<string, unknown>): ServicesSearch => ({
		type: typeof raw.type === "string" ? raw.type : undefined,
		tier: typeof raw.tier === "string" ? raw.tier : undefined,
		team: typeof raw.team === "string" ? raw.team : undefined,
		search: typeof raw.search === "string" ? raw.search : undefined,
		page: typeof raw.page === "number" ? raw.page : 1,
		view: raw.view === "grid" || raw.view === "table" ? raw.view : "table",
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
					search={{ tab: "overview" }}
					className="hover:text-primary"
				>
					<div>
						<p className="font-medium">{s.displayName || s.name}</p>
						{s.displayName && (
							<Mono className="text-xs text-muted-foreground block">
								{s.name}
							</Mono>
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
			<StateChip tone="neutral" className="capitalize">
				{row.original.type}
			</StateChip>
		),
	},
	{
		accessorKey: "tier",
		header: "Tier",
		cell: ({ row }) => (
			<StateChip tone={tierTones[row.original.tier] || "neutral"}>
				{tierLabels[row.original.tier] || row.original.tier}
			</StateChip>
		),
	},
	{
		accessorKey: "team",
		header: "Team",
		cell: ({ row }) => (
			<span className="text-muted-foreground">{row.original.team || "—"}</span>
		),
	},
	{
		id: "sources",
		header: "Sources",
		cell: ({ row }) => {
			const s = row.original;
			const repos = s.repositories ?? [];
			if (repos.length === 0) {
				return <span className="text-muted-foreground">—</span>;
			}
			return (
				<div className="flex flex-wrap gap-1">
					{repos.map((sr) => (
						<span
							key={sr.repository?.id ?? sr.repositoryId}
							className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs text-muted-foreground"
						>
							<span>🔗</span>
							<Mono>{sr.repository?.fullName ?? sr.repositoryId}</Mono>
						</span>
					))}
				</div>
			);
		},
	},
];

interface ReviewItem {
	key: string;
	id?: string; // DB repo id if already exists
	fullName: string;
	name: string;
	url?: string;
	description?: string | null;
	language?: string | null;
	isPrivate?: boolean;
	connectionId?: string;
	source: "github" | "gitlab" | "unlinked";
}

function toKebabCase(str: string): string {
	return str
		.replace(/[^a-zA-Z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.toLowerCase();
}

function toTitleCase(str: string): string {
	return str.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ServicesPage() {
	const searchParams = Route.useSearch();
	const navigate = useNavigate({ from: "/services/" });
	const [showAddDialog, setShowAddDialog] = useState(false);

	const typeFilter = (searchParams.type || "all") as ServiceType | "all";
	const tierFilter = (searchParams.tier || "all") as ServiceTier | "all";
	const teamFilter = searchParams.team || "all";
	const currentPage = searchParams.page ?? 1;
	const view = searchParams.view ?? "table";
	const offset = (currentPage - 1) * PAGE_SIZE;

	// Review queue state
	const [vcsScannedRepos, setVcsScannedRepos] = useState<ReviewItem[]>([]);
	const [isFetchingVcs, setIsFetchingVcs] = useState(false);
	const [selectedServiceForRepo, setSelectedServiceForRepo] = useState<
		Record<string, string>
	>({});
	const [itemToDelete, setItemToDelete] = useState<ReviewItem | null>(null);

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

	// Connections for VCS scanning
	const { data: allConnections = [] } = useConnections();
	const vcsConnections = useMemo(
		() =>
			allConnections.filter(
				(c) =>
					c.template?.category === "vcs" ||
					c.templateId?.startsWith("github") ||
					c.templateId?.startsWith("gitlab") ||
					c.integration?.templateId?.startsWith("github") ||
					c.integration?.templateId?.startsWith("gitlab"),
			),
		[allConnections],
	);

	// Unlinked DB repositories
	const { data: repoResponse, refetch: refetchRepos } = useRepositories({
		limit: 100,
	});
	const unlinkedDbRepos = useMemo(() => {
		return (repoResponse?.data ?? []).filter(
			(r) => !r.services || r.services.length === 0,
		);
	}, [repoResponse]);

	// Fetch services with server-side filtering
	const {
		data: response,
		isLoading,
		refetch: refetchServices,
	} = useServices({
		limit: PAGE_SIZE,
		offset,
		type: typeFilter !== "all" ? typeFilter : undefined,
		tier: tierFilter !== "all" ? tierFilter : undefined,
		team: teamFilter !== "all" ? teamFilter : undefined,
		search: searchParams.search || undefined,
	});

	// Fetch all services for linking dropdown
	const { data: allServicesResponse } = useServices({ limit: 100 });
	const allServices = allServicesResponse?.data ?? [];

	// Service teams
	const { data: teamsResponse } = useServiceTeams();
	const teams = teamsResponse?.teams ?? [];
	const teamOptions =
		teamFilter !== "all" && !teams.includes(teamFilter)
			? [teamFilter, ...teams]
			: teams;

	const services = response?.data ?? [];
	const total = response?.total ?? 0;
	const totalPages = Math.ceil(total / PAGE_SIZE);
	const showingFrom = total > 0 ? offset + 1 : 0;
	const showingTo = Math.min(offset + PAGE_SIZE, total);

	const hasFilters =
		typeFilter !== "all" ||
		tierFilter !== "all" ||
		teamFilter !== "all" ||
		!!searchParams.search;

	const handleClearFilters = () => {
		updateSearch({
			type: undefined,
			tier: undefined,
			team: undefined,
			search: undefined,
			page: 1,
		});
	};

	// Mutations for review queue actions
	const linkRepository = useLinkRepository();
	const createService = useCreateService();
	const deleteRepository = useDeleteRepository();
	const batchCreateRepositories = useBatchCreateRepositories();

	// Combine unlinked DB repos and scanned VCS repos into reviewItems
	const reviewItems = useMemo<ReviewItem[]>(() => {
		const items: ReviewItem[] = [];
		const seenNames = new Set<string>();

		// 1. Unlinked repositories already in DB
		for (const r of unlinkedDbRepos) {
			seenNames.add(r.fullName);
			const source: "github" | "gitlab" | "unlinked" = r.url?.includes("github")
				? "github"
				: r.url?.includes("gitlab")
					? "gitlab"
					: "unlinked";
			items.push({
				key: `db:${r.id}`,
				id: r.id,
				fullName: r.fullName,
				name: r.fullName.split("/").pop() ?? r.fullName,
				url: r.url ?? undefined,
				description: r.description,
				language: r.language,
				source,
			});
		}

		// 2. Scanned VCS repos not yet in DB or without service
		for (const v of vcsScannedRepos) {
			if (!seenNames.has(v.fullName)) {
				seenNames.add(v.fullName);
				items.push(v);
			}
		}

		return items;
	}, [unlinkedDbRepos, vcsScannedRepos]);

	// Fetch from VCS handler
	const handleFetchVcs = async () => {
		setIsFetchingVcs(true);
		try {
			const scanned: ReviewItem[] = [];
			for (const conn of vcsConnections) {
				try {
					const gitRepos = await client.integrations.getGitRepositories({
						id: conn.id,
					});
					const templateId =
						conn.templateId || conn.integration?.templateId || "";
					const source: "github" | "gitlab" | "unlinked" =
						templateId.startsWith("gitlab")
							? "gitlab"
							: templateId.startsWith("github")
								? "github"
								: "unlinked";

					for (const gr of gitRepos) {
						// Check if repo already belongs to a service
						const isImported = (repoResponse?.data ?? []).some(
							(r) =>
								r.fullName === gr.fullName &&
								r.services &&
								r.services.length > 0,
						);
						if (!isImported) {
							scanned.push({
								key: `vcs:${gr.fullName}`,
								fullName: gr.fullName,
								name: gr.name,
								url: gr.url,
								description: gr.description,
								language: gr.language,
								isPrivate: gr.isPrivate,
								connectionId: conn.id,
								source,
							});
						}
					}
				} catch {
					// Continue to next connection
				}
			}
			setVcsScannedRepos(scanned);
			await refetchRepos();
		} finally {
			setIsFetchingVcs(false);
		}
	};

	// Review queue inline actions
	const handleLinkToService = async (
		item: ReviewItem,
		targetServiceId: string,
	) => {
		try {
			let repoId = item.id;
			if (!repoId && item.connectionId) {
				const batch = await batchCreateRepositories.mutateAsync({
					repositories: [
						{
							connectionId: item.connectionId,
							fullName: item.fullName,
							url: item.url ?? `https://${item.source}.com/${item.fullName}`,
							description: item.description ?? undefined,
							language: item.language ?? undefined,
							isPrivate: item.isPrivate ?? false,
						},
					],
				});
				repoId = batch.repositories[0].id;
			}
			if (repoId) {
				await linkRepository.mutateAsync({
					id: repoId,
					serviceId: targetServiceId,
					isPrimary: true,
				});
				setVcsScannedRepos((prev) => prev.filter((r) => r.key !== item.key));
				await Promise.all([refetchRepos(), refetchServices()]);
			}
		} catch {
			// error surfaced in UI
		}
	};

	const handleImportAsService = async (item: ReviewItem) => {
		try {
			const serviceName = toKebabCase(item.fullName.replace("/", "-"));
			const newService = await createService.mutateAsync({
				name: serviceName,
				displayName: toTitleCase(item.name),
				description: item.description ?? undefined,
				type: "service",
				tier: "tier_3",
			});

			let repoId = item.id;
			if (!repoId && item.connectionId) {
				const batch = await batchCreateRepositories.mutateAsync({
					repositories: [
						{
							connectionId: item.connectionId,
							fullName: item.fullName,
							url: item.url ?? `https://${item.source}.com/${item.fullName}`,
							description: item.description ?? undefined,
							language: item.language ?? undefined,
							isPrivate: item.isPrivate ?? false,
						},
					],
				});
				repoId = batch.repositories[0].id;
			}

			if (repoId) {
				await linkRepository.mutateAsync({
					id: repoId,
					serviceId: newService.id,
					isPrimary: true,
				});
			}

			setVcsScannedRepos((prev) => prev.filter((r) => r.key !== item.key));
			await Promise.all([refetchRepos(), refetchServices()]);
		} catch {
			// error surfaced in UI
		}
	};

	const handleConfirmDelete = async () => {
		if (!itemToDelete) return;
		try {
			if (itemToDelete.id) {
				await deleteRepository.mutateAsync({ id: itemToDelete.id });
			}
			setVcsScannedRepos((prev) =>
				prev.filter((r) => r.key !== itemToDelete.key),
			);
			setItemToDelete(null);
			await refetchRepos();
		} catch {
			// handled
		}
	};

	return (
		<SettingsFrame
			section="services"
			title="Services"
			intro={`${total} in the catalog. A run reads the repository a service names; nothing else.`}
			actions={
				<Button
					size="sm"
					className="h-7"
					onClick={() => setShowAddDialog(true)}
				>
					<Plus className="mr-1 h-3.5 w-3.5" />
					Add service
				</Button>
			}
		>
			{/* Review Queue */}
			<RecordSection
				id="review-queue"
				title="Waiting for a decision"
				count={reviewItems.length}
				actions={
					<Button
						variant="outline"
						size="sm"
						onClick={handleFetchVcs}
						disabled={isFetchingVcs}
					>
						<RefreshCw
							className={cn(
								"mr-1.5 h-3.5 w-3.5",
								isFetchingVcs && "animate-spin",
							)}
						/>
						Fetch from VCS
					</Button>
				}
			>
				{reviewItems.length === 0 ? (
					<div
						className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed p-4"
						data-testid="review-queue-empty"
					>
						<p className="text-record text-muted-foreground">
							Nothing waiting. Fetch from VCS to find repositories without a
							service.
						</p>
					</div>
				) : (
					<div className="space-y-2">
						{reviewItems.map((item) => {
							const selectedSvcId = selectedServiceForRepo[item.key] ?? "";
							return (
								<div
									key={item.key}
									className="flex flex-wrap items-center justify-between gap-3 p-3 border rounded-lg bg-card"
								>
									<div className="flex items-center gap-2.5 min-w-0">
										<StateChip tone="neutral">{item.source}</StateChip>
										<Mono className="font-medium text-sm truncate">
											{item.fullName}
										</Mono>
									</div>
									<div className="flex flex-wrap items-center gap-2">
										<div className="flex items-center gap-1.5">
											<Select
												value={selectedSvcId}
												onValueChange={(val) =>
													setSelectedServiceForRepo((prev) => ({
														...prev,
														[item.key]: val,
													}))
												}
											>
												<SelectTrigger className="w-44 h-8 text-xs">
													<SelectValue placeholder="Select service..." />
												</SelectTrigger>
												<SelectContent>
													{allServices.map((s) => (
														<SelectItem key={s.id} value={s.id}>
															{s.displayName || s.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<Button
												size="sm"
												variant="outline"
												className="h-8 text-xs"
												disabled={!selectedSvcId || linkRepository.isPending}
												onClick={() => handleLinkToService(item, selectedSvcId)}
											>
												Link
											</Button>
										</div>
										<Button
											size="sm"
											variant="outline"
											className="h-8 text-xs"
											onClick={() => handleImportAsService(item)}
											disabled={createService.isPending}
										>
											Import as service
										</Button>
										<Button
											size="sm"
											variant="ghost"
											className="h-8 text-xs text-destructive hover:text-destructive"
											onClick={() => setItemToDelete(item)}
										>
											Delete
										</Button>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</RecordSection>

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

				{(teamOptions.length > 0 || teamFilter !== "all") && (
					<Select
						value={teamFilter}
						onValueChange={(value) =>
							updateSearch({
								team: value === "all" ? undefined : value,
								page: 1,
							})
						}
					>
						<SelectTrigger
							className="w-[180px]"
							data-testid="services-team-filter"
						>
							<SelectValue placeholder="Filter by team" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All teams</SelectItem>
							{teamOptions.map((team) => (
								<SelectItem key={team} value={team}>
									{team}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}

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
						navigate({
							to: "/services/$id",
							params: { id: row.id },
							search: { tab: "overview" },
						})
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
				onSuccess={() => refetchServices()}
			/>

			{/* Delete repository confirmation */}
			<DestructiveConfirm
				open={!!itemToDelete}
				onOpenChange={(open) => {
					if (!open) setItemToDelete(null);
				}}
				title="Delete repository?"
				description={
					<p>
						<strong>{itemToDelete?.fullName}</strong> leaves PrismaLens. The
						repository on GitHub or GitLab is untouched.
					</p>
				}
				confirmLabel="Delete"
				onConfirm={handleConfirmDelete}
				isPending={deleteRepository.isPending}
			/>
		</SettingsFrame>
	);
}
