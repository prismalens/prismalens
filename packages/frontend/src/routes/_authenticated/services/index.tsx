// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ServiceWithRelations } from "@prismalens/contracts";
import { isIncidentOpen } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
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
import { Hint } from "@/components/shared/Hint";
import { Mono } from "@/components/shared/Mono";
import { RecordSection } from "@/components/shared/RecordSection";
import { Empty, Loading } from "@/components/shared/State";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { markFirstOpened, useFirstOpen } from "@/hooks/use-first-open";
import { usePageTitle } from "@/hooks/use-page-title";
import {
	useConnections,
	useCreateService,
	useDeleteRepository,
	useLinkRepository,
	useRepositories,
	useServices,
	useServiceTeams,
} from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";
import { cn } from "@/lib/utils";

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

/** A repository already saved that no service names (a 0.5.0 import may have left some). */
interface ReviewItem {
	key: string;
	id: string;
	fullName: string;
	name: string;
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

	// The telemetry every run is told about
	const { data: allConnections = [] } = useConnections();
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
			unlinkedDbRepos.map((r) => ({
				key: `db:${r.id}`,
				id: r.id,
				fullName: r.fullName,
				name: r.fullName.split("/").pop() ?? r.fullName,
				description: r.description,
			})),
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

	return (
		<div
			className="fixed inset-x-0 bottom-0 top-(--frame-top) flex flex-col bg-canvas md:left-(--sidebar-w)"
			data-testid="services-page"
		>
			<PageHeader
				title="Services"
				primary={
					<Button
						size="sm"
						className="pl-2"
						onClick={() => setShowAddDialog(true)}
						data-testid="add-service"
					>
						<Plus />
						New service
					</Button>
				}
			>
				<div className="flex basis-full items-center gap-2 md:basis-auto">
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
				<div className="mx-auto w-full max-w-[52rem] px-4 pt-4 pb-12">
					{isLoading ? (
						<Loading />
					) : services.length === 0 ? (
						searchParams.search || teamFilter !== "all" ? (
							<Empty text="No service matches." testId="services-empty" />
						) : (
							<Empty
								text="No services yet. A service names the code the agent reads."
								testId="services-empty"
							/>
						)
					) : (
						<h2
							className="mb-3 text-body font-medium text-text-2"
							data-testid="services-count"
						>
							{`${total} service${total === 1 ? "" : "s"}`}
						</h2>
					)}
					<ul
						className={cn(
							"divide-y divide-hairline",
							services.length > 0 && "pool px-4 py-1",
						)}
						data-testid="services-list"
					>
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
							title="Repositories no service names"
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
		<li data-testid="service-row">
			<Link
				to="/services/$id"
				params={{ id: service.id }}
				className="group/row -mx-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 rounded-control px-2 py-2.5 transition-colors duration-(--dur-instant) hover:bg-surface-2"
				data-testid="service-row-link"
			>
				<p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
					<span
						className="font-semibold text-text-1"
						data-testid="service-name"
					>
						{service.name}
					</span>
					<span className="text-meta text-text-3" data-testid="service-kind">
						{kindWord(service.type)}
					</span>
					<Hint label={tierMeaning(service.tier)}>
						<span className="text-meta text-text-3">
							{tierWord(service.tier)}
						</span>
					</Hint>
					{service.team && (
						<span className="text-meta text-text-3">{service.team}</span>
					)}
				</p>
				<span
					className="row-span-2 text-meta text-text-3 tabular-nums group-hover/row:text-text-2"
					data-testid="service-open"
				>
					{open ? `${open} open` : "none open"}
				</span>
				<p
					className="flex min-w-0 items-baseline gap-2 text-meta text-text-2"
					data-testid="service-line"
				>
					{code ? (
						<LeftTruncated text={code} testId="service-code" />
					) : (
						<span className="shrink-0">No code</span>
					)}
					<span
						className="shrink-0 whitespace-nowrap text-text-3"
						data-testid="service-telemetry"
					>
						{telemetry.length
							? `Telemetry from ${telemetry.join(", ")}`
							: "No telemetry"}
					</span>
					{uses.length > 0 && (
						<span className="truncate text-text-3">
							Depends on {uses.join(", ")}
						</span>
					)}
					{usedBy.length > 0 && (
						<span className="truncate text-text-3">
							Used by {usedBy.join(", ")}
						</span>
					)}
				</p>
			</Link>
		</li>
	);
}

/**
 * A path cut from the left, so its end shows; the tooltip holds all of it.
 * The row link is the only focus stop, so focusing it unwraps the whole path.
 */
function LeftTruncated({ text, testId }: { text: string; testId?: string }) {
	return (
		<Hint label={text}>
			<span
				className="min-w-0 truncate text-left font-mono [direction:rtl] group-focus-visible/row:break-all group-focus-visible/row:whitespace-normal group-focus-visible/row:[direction:ltr]"
				data-testid={testId}
			>
				<bdi>{text}</bdi>
			</span>
		</Hint>
	);
}
