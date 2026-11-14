// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isIncidentOpen } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListGrid } from "@/components/kit/ListCard";
import { healthOf, ServiceCard } from "@/components/services/ServiceCard";
import { ServiceFormDialog } from "@/components/services/ServiceFormDialog";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Hint } from "@/components/shared/Hint";
import { Mono } from "@/components/shared/Mono";
import { RecordSection } from "@/components/shared/RecordSection";
import { Blank, Empty, Loading } from "@/components/shared/State";
import { PageHeader } from "@/components/shell/PageHeader";
import { HelperThread } from "@/components/thread/HelperThread";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { markFirstOpened, useFirstOpen } from "@/hooks/use-first-open";
import { useNow } from "@/hooks/use-now";
import { usePageTitle } from "@/hooks/use-page-title";
import {
	useCreateService,
	useDeleteRepository,
	useLinkRepository,
	useRepositories,
	useServices,
	useServiceTeams,
} from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";
import {
	parseServicesSearch,
	type ServicesSearch,
} from "@/lib/services-search";

const PAGE_SIZE = 50;

export const Route = createFileRoute("/_authenticated/services/")({
	validateSearch: parseServicesSearch,
	component: ServicesPage,
});

/** A repository already saved that no service names (a 0.5.0 import may have left some). */
interface ReviewItem {
	key: string;
	id: string;
	fullName: string;
	name: string;
	/** Where it is: its folder or git URL, which tells same-named projects apart. */
	location: string;
	description?: string | null;
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
	const [arrivedToAdd] = useState(searchParams.add === "1");
	const [showAddDialog, setShowAddDialog] = useState(arrivedToAdd);
	const [addOpened, setAddOpened] = useState(arrivedToAdd);
	if (showAddDialog && !addOpened) setAddOpened(true);
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
	const { data: openIncidents } = useQuery(
		orpc.incidents.list.queryOptions({ input: { open: true, limit: 100 } }),
	);
	const now = useNow(60_000);
	// Each service's open incidents, by severity, for its health mark and count.
	const openBy = new Map<string, string[]>();
	for (const i of openIncidents?.data ?? []) {
		if (!isIncidentOpen(i.status)) continue;
		for (const s of i.services ?? [])
			openBy.set(s.id, [...(openBy.get(s.id) ?? []), i.severity]);
	}

	const { data: teamsResponse } = useServiceTeams();
	const teams = teamsResponse?.teams ?? [];
	const teamOptions =
		teamFilter !== "all" && !teams.includes(teamFilter)
			? [teamFilter, ...teams]
			: teams;

	const services = response?.data ?? [];
	const total = response?.total ?? 0;
	// From the door at ≥ 1024 the first service opens; the list stays one Back away (L32).
	// A visit that came to add, or opened Add, stays put: the first service can land while the dialog links it.
	const openFirst = useFirstOpen(
		"/services",
		!searchParams.team &&
			!searchParams.search &&
			currentPage === 1 &&
			!addOpened,
	);
	const firstId = services[0]?.id;
	useEffect(() => {
		if (!openFirst || !firstId) return;
		markFirstOpened("/services");
		void navigate({
			to: "/services/$id",
			params: { id: firstId },
			replace: true,
		});
	}, [openFirst, firstId, navigate]);
	const totalPages = Math.ceil(total / PAGE_SIZE);

	const linkRepository = useLinkRepository();
	const createService = useCreateService();
	const deleteRepository = useDeleteRepository();
	const reviewItems = useMemo<ReviewItem[]>(
		() =>
			unlinkedDbRepos
				.map((r) => ({
					key: `db:${r.id}`,
					id: r.id,
					fullName: r.fullName,
					name: r.fullName.split("/").pop() ?? r.fullName,
					location: r.subPath ? `${r.url} › ${r.subPath}` : r.url,
					description: r.description,
				}))
				// Same names sit together, each told apart by where it is.
				.sort(
					(a, b) =>
						a.name.localeCompare(b.name) ||
						a.location.localeCompare(b.location),
				),
		[unlinkedDbRepos],
	);

	// Review queue inline actions
	const handleLinkToService = async (
		item: ReviewItem,
		targetServiceId: string,
	) => {
		try {
			await linkRepository.mutateAsync({
				id: item.id,
				serviceId: targetServiceId,
				isPrimary: true,
			});
			await Promise.all([refetchRepos(), refetchServices()]);
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

			await linkRepository.mutateAsync({
				id: item.id,
				serviceId: newService.id,
				isPrimary: true,
			});
			await Promise.all([refetchRepos(), refetchServices()]);
		} catch {
			// error surfaced in UI
		}
	};

	const handleConfirmDelete = async () => {
		if (!itemToDelete) return;
		await deleteRepository.mutateAsync({ id: itemToDelete.id });
		await refetchRepos();
	};

	// Repositories waiting for a service keep the list page, so they stay reachable.
	const none =
		!isLoading &&
		response?.total === 0 &&
		reviewItems.length === 0 &&
		!searchParams.search &&
		teamFilter === "all";
	return (
		<div className="flex h-full flex-col bg-canvas" data-testid="services-page">
			<PageHeader
				title="Services"
				primary={
					!none && (
						<Button
							size="sm"
							className="pl-2"
							onClick={() => setShowAddDialog(true)}
							data-testid="add-service"
						>
							<Plus />
							New service
						</Button>
					)
				}
			>
				<div className="flex min-w-0 basis-full items-center gap-2 md:basis-auto">
					<Button variant="text" size="sm" asChild>
						<Link to="/projects" data-testid="services-projects-link">
							Projects
						</Link>
					</Button>
					{!none && (
						<>
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
						</>
					)}
				</div>
			</PageHeader>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{none ? (
					<>
						<Blank title="Add your first service" testId="services-empty">
							<Button
								onClick={() => setShowAddDialog(true)}
								data-testid="add-service"
							>
								<Plus />
								Add a service
							</Button>
						</Blank>
						<HelperThread
							place="services"
							className="mx-auto max-w-(--reading-w) px-4 pb-8"
						/>
					</>
				) : (
					<div className="w-full px-4 pt-3 pb-12">
						{isLoading ? (
							<Loading />
						) : services.length === 0 ? (
							searchParams.search || teamFilter !== "all" ? (
								<Empty text="No service matches." testId="services-empty" />
							) : (
								<>
									<Empty text="No services yet." testId="services-empty" />
									<HelperThread place="services" className="mt-4" />
								</>
							)
						) : (
							<h2
								className="mb-2 text-body font-medium text-text-2"
								data-testid="services-count"
							>
								{`${total} service${total === 1 ? "" : "s"}`}
							</h2>
						)}
						{services.length > 0 && (
							<ListGrid label="Services" testId="services-list">
								{services.map((s) => (
									<ServiceCard
										key={s.id}
										service={s}
										open={openBy.get(s.id)?.length ?? 0}
										health={healthOf(
											openBy.get(s.id) ?? [],
											s.lastReportAt,
											now,
										)}
										now={now}
									/>
								))}
							</ListGrid>
						)}
						{totalPages > 1 && (
							<div className="mt-3 flex items-center gap-3 text-meta text-text-3">
								<Button
									variant="text"
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
									variant="text"
									size="sm"
									disabled={currentPage >= totalPages}
									onClick={() => updateSearch({ page: currentPage + 1 })}
								>
									Next
								</Button>
							</div>
						)}

						{reviewItems.length > 0 && (
							<RecordSection
								id="review-queue"
								className="mt-10"
								title="Projects not in a service"
								count={reviewItems.length}
							>
								<ul className="divide-y divide-hairline">
									{reviewItems.map((item) => {
										const selected = selectedServiceForRepo[item.key] ?? "";
										return (
											<li
												key={item.key}
												className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center"
											>
												<div className="min-w-0 flex-1">
													<span className="block truncate text-body text-text-1">
														{item.fullName}
													</span>
													<Hint label={item.location}>
														<Mono
															className="block truncate text-meta text-text-3"
															data-testid="review-location"
														>
															{item.location}
														</Mono>
													</Hint>
													{item.description && (
														<p className="truncate text-meta text-text-3">
															{item.description}
														</p>
													)}
												</div>
												<div className="flex flex-wrap items-center gap-2">
													<Button
														variant="secondary"
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
							</RecordSection>
						)}
					</div>
				)}
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
						repository on its git host is untouched.
					</p>
				}
				confirmLabel="Remove"
				onConfirm={handleConfirmDelete}
				isPending={deleteRepository.isPending}
			/>
		</div>
	);
}
