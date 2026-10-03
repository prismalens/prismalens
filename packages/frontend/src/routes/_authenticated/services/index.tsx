// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ServiceWithRelations } from "@prismalens/contracts";
import { isIncidentOpen } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ServiceFormDialog } from "@/components/services/ServiceFormDialog";
import {
	codeWhere,
	kindWord,
	tierMeaning,
	tierWord,
} from "@/components/services/service-detail.utils";
import { PULL_TEMPLATES } from "@/components/settings/SettingsFrame";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Mono } from "@/components/shared/Mono";
import { RecordSection } from "@/components/shared/RecordSection";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { usePageTitle } from "@/hooks/use-page-title";
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
import { client, orpc } from "@/lib/api/orpc-client";

const PAGE_SIZE = 50;

type ServicesSearch = {
	team?: string;
	search?: string;
	page?: number;
	/** `1` opens the add dialog: the board's setup line links here. */
	add?: "1";
};

export const Route = createFileRoute("/_authenticated/services/")({
	validateSearch: (raw: Record<string, unknown>): ServicesSearch => ({
		team: typeof raw.team === "string" ? raw.team : undefined,
		search: typeof raw.search === "string" ? raw.search : undefined,
		page: typeof raw.page === "number" ? raw.page : undefined,
		add: raw.add === "1" ? "1" : undefined,
	}),
	component: ServicesPage,
});

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
	usePageTitle("Services");
	const searchParams = Route.useSearch();
	const navigate = useNavigate({ from: "/services/" });
	const [showAddDialog, setShowAddDialog] = useState(searchParams.add === "1");
	useEffect(() => {
		if (searchParams.add === "1") {
			setShowAddDialog(true);
			navigate({
				search: (p: ServicesSearch) => ({ ...p, add: undefined }),
				replace: true,
			});
		}
	}, [searchParams.add, navigate]);

	const teamFilter = searchParams.team || "all";
	const currentPage = searchParams.page ?? 1;
	const offset = (currentPage - 1) * PAGE_SIZE;
	const [q, setQ] = useState(searchParams.search ?? "");
	// The search this input last wrote; any other URL value came from a link or Back.
	const wrote = useRef(searchParams.search);
	useEffect(() => {
		if (searchParams.search === wrote.current) return;
		wrote.current = searchParams.search;
		setQ(searchParams.search ?? "");
	}, [searchParams.search]);

	// Review queue state
	const [vcsScannedRepos, setVcsScannedRepos] = useState<ReviewItem[]>([]);
	const [isFetchingVcs, setIsFetchingVcs] = useState(false);
	const [selectedServiceForRepo, setSelectedServiceForRepo] = useState<
		Record<string, string>
	>({});
	const [itemToDelete, setItemToDelete] = useState<ReviewItem | null>(null);

	const updateSearch = useCallback(
		(updates: Partial<ServicesSearch>) => {
			navigate({
				search: (prev: ServicesSearch) => ({ ...prev, ...updates }),
				replace: true,
			});
		},
		[navigate],
	);
	useEffect(() => {
		const next = q.trim() || undefined;
		// A no-op write lands 250 ms after mount and cancels a row click whose
		// route is still loading (shell-pr2.feature, Back from a service).
		if (next === searchParams.search) return;
		const t = setTimeout(() => {
			wrote.current = next;
			updateSearch({ search: next, page: undefined });
		}, 250);
		return () => clearTimeout(t);
	}, [q, searchParams.search, updateSearch]);

	// Connections for VCS scanning, and the telemetry every run is told about
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
	const telemetry = allConnections
		.filter((c) => PULL_TEMPLATES.has(c.templateId ?? ""))
		.map((c) => c.label);

	const { data: repoResponse, refetch: refetchRepos } = useRepositories({
		limit: 100,
	});
	const unlinkedDbRepos = useMemo(
		() =>
			(repoResponse?.data ?? []).filter(
				(r) => !r.services || r.services.length === 0,
			),
		[repoResponse],
	);

	const {
		data: response,
		isLoading,
		refetch: refetchServices,
	} = useServices({
		limit: PAGE_SIZE,
		offset,
		team: teamFilter !== "all" ? teamFilter : undefined,
		search: searchParams.search || undefined,
	});
	const { data: allServicesResponse } = useServices({ limit: 100 });
	const allServices = allServicesResponse?.data ?? [];
	const nameOf = new Map(allServices.map((s) => [s.id, s.name]));
	const { data: openIncidents } = useQuery(
		orpc.incidents.list.queryOptions({ input: { open: true, limit: 100 } }),
	);
	const openBy = new Map<string, number>();
	for (const i of openIncidents?.data ?? []) {
		if (!isIncidentOpen(i.status)) continue;
		for (const s of i.services ?? [])
			openBy.set(s.id, (openBy.get(s.id) ?? 0) + 1);
	}

	const { data: teamsResponse } = useServiceTeams();
	const teams = teamsResponse?.teams ?? [];
	const teamOptions =
		teamFilter !== "all" && !teams.includes(teamFilter)
			? [teamFilter, ...teams]
			: teams;

	const services = response?.data ?? [];
	const total = response?.total ?? 0;
	const totalPages = Math.ceil(total / PAGE_SIZE);

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
		<div
			className="fixed inset-x-0 bottom-0 top-(--frame-top) flex flex-col bg-canvas md:left-(--sidebar-w)"
			data-testid="services-page"
		>
			<PageHeader title="Services">
				<div className="flex basis-full items-center gap-2 md:ml-auto md:basis-auto">
					<label className="raised flex h-7 min-w-0 flex-1 items-center gap-2 rounded-control px-2.5 md:w-44 md:flex-none">
						<Search className="size-3.5 shrink-0 text-text-3" />
						<input
							value={q}
							onChange={(e) => setQ(e.target.value)}
							placeholder="Filter"
							aria-label="Filter services"
							className="h-6 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-text-3 md:text-body"
							data-testid="services-search"
						/>
					</label>
					{teamOptions.length > 0 && (
						<Select
							value={teamFilter}
							onValueChange={(v) =>
								updateSearch({
									team: v === "all" ? undefined : v,
									page: undefined,
								})
							}
						>
							<SelectTrigger
								className="h-7 w-auto min-w-28"
								aria-label="Team"
								data-testid="services-team-filter"
							>
								<SelectValue placeholder="Every team" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">Every team</SelectItem>
								{teamOptions.map((t) => (
									<SelectItem key={t} value={t}>
										{t}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
				</div>
			</PageHeader>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="px-4 pt-3 pb-12 md:px-6">
					<div className="mb-2 flex min-h-6 items-center justify-between gap-3">
						<h2 className="text-heading" data-testid="services-count">
							{isLoading
								? "Services"
								: `${total} service${total === 1 ? "" : "s"}`}
						</h2>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setShowAddDialog(true)}
							data-testid="add-service"
						>
							Add a service
						</Button>
					</div>
					{!isLoading && services.length === 0 && (
						<p className="text-body text-text-2" data-testid="services-empty">
							{searchParams.search || teamFilter !== "all"
								? "No service matches."
								: "No services yet. A service names the code a run reads and the telemetry it may query."}
						</p>
					)}
					<ul data-testid="services-list">
						{services.map((s) => (
							<ServiceRow
								key={s.id}
								service={s}
								open={openBy.get(s.id) ?? 0}
								telemetry={telemetry}
								nameOf={nameOf}
							/>
						))}
					</ul>
					{totalPages > 1 && (
						<div className="mt-3 flex items-center gap-3 text-meta text-text-3">
							<Button
								variant="ghost"
								size="sm"
								disabled={currentPage <= 1}
								onClick={() => updateSearch({ page: currentPage - 1 })}
							>
								Previous
							</Button>
							<span>
								Page {currentPage} of {totalPages}
							</span>
							<Button
								variant="ghost"
								size="sm"
								disabled={currentPage >= totalPages}
								onClick={() => updateSearch({ page: currentPage + 1 })}
							>
								Next
							</Button>
						</div>
					)}

					{(reviewItems.length > 0 || vcsConnections.length > 0) && (
						<RecordSection
							id="review-queue"
							className="mt-10"
							title="Repositories no service names"
							count={reviewItems.length || undefined}
							actions={
								vcsConnections.length > 0 && (
									<Button
										variant="ghost"
										size="sm"
										onClick={handleFetchVcs}
										disabled={isFetchingVcs}
									>
										{isFetchingVcs ? "Fetching" : "Fetch from the git host"}
									</Button>
								)
							}
						>
							{reviewItems.length === 0 ? (
								<p
									className="text-body text-text-2"
									data-testid="review-queue-empty"
								>
									None waiting.
								</p>
							) : (
								<ul>
									{reviewItems.map((item) => {
										const selected = selectedServiceForRepo[item.key] ?? "";
										return (
											<li
												key={item.key}
												className="flex flex-col gap-2 border-t border-hairline py-2.5 first:border-t-0 sm:flex-row sm:items-center"
											>
												<div className="min-w-0 flex-1">
													<Mono className="block truncate text-text-1">
														{item.fullName}
													</Mono>
													{item.description && (
														<p className="truncate text-meta text-text-3">
															{item.description}
														</p>
													)}
												</div>
												<div className="flex flex-wrap items-center gap-2">
													<Button
														variant="ghost"
														size="sm"
														onClick={() => handleImportAsService(item)}
													>
														Make it a service
													</Button>
													<Select
														value={selected}
														onValueChange={(v) => {
															setSelectedServiceForRepo((prev) => ({
																...prev,
																[item.key]: v,
															}));
															void handleLinkToService(item, v);
														}}
													>
														<SelectTrigger
															className="h-7 w-auto min-w-32"
															aria-label={`Give ${item.fullName} to a service`}
														>
															<SelectValue placeholder="Give it to" />
														</SelectTrigger>
														<SelectContent>
															{allServices.map((svc) => (
																<SelectItem key={svc.id} value={svc.id}>
																	{svc.name}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
													<Button
														variant="danger"
														size="sm"
														onClick={() => setItemToDelete(item)}
													>
														Remove
													</Button>
												</div>
											</li>
										);
									})}
								</ul>
							)}
						</RecordSection>
					)}
				</div>
			</div>

			<ServiceFormDialog
				open={showAddDialog}
				onOpenChange={setShowAddDialog}
				onSuccess={() => refetchServices()}
			/>
			<DestructiveConfirm
				open={!!itemToDelete}
				onOpenChange={(open) => {
					if (!open) setItemToDelete(null);
				}}
				title="Remove this repository?"
				description={
					<p>
						<strong>{itemToDelete?.fullName}</strong> leaves PrismaLens. The
						repository on GitHub or GitLab is untouched.
					</p>
				}
				confirmLabel="Remove"
				onConfirm={handleConfirmDelete}
				isPending={deleteRepository.isPending}
			/>
		</div>
	);
}

/**
 * One service (study-v3 §7): its name, kind, tier and team; the code a run
 * reads, its telemetry and its neighbours; and how many incidents are open.
 */
function ServiceRow({
	service,
	open,
	telemetry,
	nameOf,
}: {
	service: ServiceWithRelations;
	open: number;
	telemetry: string[];
	nameOf: Map<string, string>;
}) {
	const code = codeWhere(service);
	const uses = (service.dependencies ?? []).flatMap((d) => {
		const n = nameOf.get(d.dependencyId);
		return n ? [n] : [];
	});
	const usedBy = (service.dependents ?? []).flatMap((d) => {
		const n = nameOf.get(d.dependentId);
		return n ? [n] : [];
	});
	return (
		<li
			className="border-t border-hairline first:border-t-0"
			data-testid="service-row"
		>
			<Link
				to="/services/$id"
				params={{ id: service.id }}
				className="-mx-2 flex items-start gap-3 rounded-control px-2 py-2.5 outline-none hover:bg-surface-1 focus-visible:ring-2 focus-visible:ring-accent"
				data-testid="service-row-link"
			>
				<div className="min-w-0 flex-1">
					<p className="flex flex-wrap items-baseline gap-x-2">
						<span
							className="font-medium text-text-1"
							data-testid="service-name"
						>
							{service.name}
						</span>
						<span className="text-meta text-text-2" data-testid="service-kind">
							{kindWord(service.type)}
						</span>
						<span
							className="text-meta text-text-3"
							title={tierMeaning(service.tier)}
						>
							{tierWord(service.tier)}
						</span>
						{service.team && (
							<span className="text-meta text-text-3">{service.team}</span>
						)}
					</p>
					<p
						className="mt-0.5 text-meta text-text-2"
						data-testid="service-line"
					>
						{code ? (
							<Mono className="break-all" data-testid="service-code">
								{code}
							</Mono>
						) : (
							"No code"
						)}
						.{" "}
						<span data-testid="service-telemetry">
							{telemetry.length
								? `Telemetry from ${telemetry.join(", ")}.`
								: "No telemetry."}
						</span>
						{uses.length > 0 && ` Depends on ${uses.join(", ")}.`}
						{usedBy.length > 0 && ` Used by ${usedBy.join(", ")}.`}
					</p>
				</div>
				<span
					className="shrink-0 pt-0.5 text-meta text-text-3 tabular-nums"
					data-testid="service-open"
				>
					{open ? `${open} open` : "none open"}
				</span>
			</Link>
		</li>
	);
}
