// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isIncidentOpen } from "@prismalens/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { DeleteServiceDialog } from "@/components/services/DeleteServiceDialog";
import { ServiceCodeSection } from "@/components/services/ServiceCodeSection";
import { ServiceDependenciesSection } from "@/components/services/ServiceDependenciesSection";
import { ServiceDetailSkeleton } from "@/components/services/ServiceDetailSkeleton";
import { ServiceFormDialog } from "@/components/services/ServiceFormDialog";
import { ServiceIncidentsSection } from "@/components/services/ServiceIncidentsSection";
import { ServiceInvestigationsSection } from "@/components/services/ServiceInvestigationsSection";
import { ServiceTelemetrySection } from "@/components/services/ServiceTelemetrySection";
import {
	kindWord,
	tierMeaning,
	tierWord,
} from "@/components/services/service-detail.utils";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Hint } from "@/components/shared/Hint";
import { NotFound, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { backTarget, useBack } from "@/hooks/use-back";
import { usePageTitle } from "@/hooks/use-page-title";
import {
	useRemoveServiceDependency,
	useServiceIntegrations,
} from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/_authenticated/services/$id/")({
	// `tab` is accepted and ignored so links from before the one-page layout resolve.
	validateSearch: (search: Record<string, unknown>): { tab?: string } =>
		typeof search.tab === "string" ? { tab: search.tab } : {},
	component: ServicePage,
});

/** A service record is a leaf; Back leaves it for wherever you came from. */
const inServiceRecord = (pathname: string) => pathname.startsWith("/services/");

const DAY = 86_400_000;

/**
 * One service, one page (study-v3 §7, decision 1): what a run reads and what
 * the service depends on, in named sections with no tabs. The band carries
 * Back, the name, its kind, tier and team, Edit and the rest in a menu.
 */
function ServicePage() {
	const { id } = Route.useParams();
	const navigate = useNavigate();
	const back = useBack(inServiceRecord, "/services");
	const [editing, setEditing] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [removing, setRemoving] = useState<{ from: string; to: string } | null>(
		null,
	);
	const {
		data: service,
		isLoading,
		error,
		refetch,
	} = useQuery(orpc.services.get.queryOptions({ input: { id } }));
	const {
		data: topology,
		status: topologyStatus,
		refetch: refetchTopology,
	} = useQuery({
		...orpc.services.getTopology.queryOptions({ input: { id } }),
		enabled: !!service,
	});
	const { data: integrations = [] } = useServiceIntegrations(id);
	const { data: incidents } = useQuery(
		orpc.incidents.list.queryOptions({
			input: { serviceId: id, limit: 100 },
		}),
	);
	const removeDep = useRemoveServiceDependency();
	const queryClient = useQueryClient();
	usePageTitle(service ? `${service.name}, Services` : "Services");

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.defaultPrevented) return;
			const t = e.target as HTMLElement | null;
			if (
				t?.tagName === "INPUT" ||
				t?.tagName === "TEXTAREA" ||
				t?.isContentEditable
			)
				return;
			if (
				document.querySelector("[role=dialog], [role=alertdialog], [role=menu]")
			)
				return;
			back();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [back]);

	if (isLoading) return <ServiceDetailSkeleton />;
	if (error || !service) {
		const toList = (
			<Button variant="text" size="sm" onClick={back}>
				Back to the services
			</Button>
		);
		// Only a 404 means gone; anything else failed while the service may still be there.
		const gone = !error || (error as { status?: number }).status === 404;
		return (
			<div className="p-6">
				{gone ? (
					<NotFound
						text="This service is not here. It may have been deleted."
						back={toList}
					/>
				) : (
					<Problem
						text="This service did not load."
						onRetry={() => void refetch()}
						back={toList}
					/>
				)}
			</div>
		);
	}

	const rows = incidents?.data ?? [];
	const open = rows.filter((i) => isIncidentOpen(i.status)).length;
	const recent = rows.filter(
		(i) => Date.now() - new Date(i.triggeredAt).getTime() < 30 * DAY,
	).length;
	const backHref = backTarget(inServiceRecord, "/services");

	return (
		<div
			className="fixed inset-x-0 bottom-0 top-(--frame-top) flex flex-col bg-canvas md:left-(--sidebar-w)"
			data-testid="service-page"
		>
			<header
				className="flex min-h-(--header-h) shrink-0 items-center gap-2 px-3 md:px-4 desktop:app-drag desktop:[&_a]:app-no-drag desktop:[&_button]:app-no-drag"
				data-testid="service-band"
			>
				<Button variant="text" size="icon" className="shrink-0" asChild>
					<a
						href={backHref}
						onClick={(e) => {
							e.preventDefault();
							back();
						}}
						aria-label={
							backHref === "/services" ? "Back to the services" : "Back"
						}
						data-testid="service-back"
					>
						<ChevronLeft className="size-4" />
					</a>
				</Button>
				<h1 className="min-w-0 truncate text-title">{service.name}</h1>
				<span
					className="flex min-w-0 items-baseline gap-2.5 text-meta"
					data-testid="service-meta"
				>
					<span className="text-text-2">{kindWord(service.type)}</span>
					<Hint label={tierMeaning(service.tier)}>
						<span className="text-text-3">{tierWord(service.tier)}</span>
					</Hint>
					{service.team && (
						<span className="truncate text-text-3 max-sm:hidden">
							{service.team}
						</span>
					)}
				</span>
				<span className="flex-1" />
				<Button
					variant="text"
					size="sm"
					onClick={() => setEditing(true)}
					data-testid="service-edit"
				>
					Edit
				</Button>
				<Button
					variant="danger"
					size="sm"
					onClick={() => setDeleting(true)}
					data-testid="service-delete"
				>
					Delete
				</Button>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-[52rem] px-4 pt-3 pb-12">
					{service.description && (
						<p className="text-body text-text-1">{service.description}</p>
					)}
					<p
						className="mt-1 text-meta text-text-2 tabular-nums"
						data-testid="service-summary"
					>
						{open === 1 ? "1 incident open" : `${open} incidents open`},{" "}
						{recent} in 30 days.
					</p>
					<div className="mt-8">
						<ServiceCodeSection service={service} />
						<ServiceTelemetrySection
							serviceId={id}
							integrations={integrations}
						/>
						<ServiceDependenciesSection
							serviceId={id}
							topology={topology}
							onRemove={setRemoving}
						/>
						<ServiceInvestigationsSection
							serviceId={id}
							metadata={service.metadata}
						/>
						<ServiceIncidentsSection
							incidents={rows}
							total={incidents?.pagination.total ?? rows.length}
						/>
					</div>
				</div>
			</div>

			<ServiceFormDialog
				open={editing}
				onOpenChange={setEditing}
				service={service}
			/>
			<DeleteServiceDialog
				open={deleting}
				onOpenChange={setDeleting}
				serviceId={service.id}
				serviceName={service.displayName || service.name}
				upstream={(topology?.upstream ?? []).map(
					(e) => e.service.displayName || e.service.name,
				)}
				downstream={(topology?.downstream ?? []).map(
					(e) => e.service.displayName || e.service.name,
				)}
				links={topologyStatus}
				onRetryLinks={() => void refetchTopology()}
				onSuccess={() => navigate({ to: "/services" })}
			/>
			<DestructiveConfirm
				open={!!removing}
				onOpenChange={(o) => !o && setRemoving(null)}
				title="Remove this dependency?"
				description={
					<p>The edge between the two services goes; both services stay.</p>
				}
				confirmLabel="Remove"
				onConfirm={() =>
					removing &&
					removeDep
						.mutateAsync({ id: removing.from, dependencyId: removing.to })
						// The edge may be the other service's; this page's topology moves too.
						.then(() =>
							queryClient.invalidateQueries({ queryKey: orpc.services.key() }),
						)
				}
				isPending={removeDep.isPending}
			/>
		</div>
	);
}
