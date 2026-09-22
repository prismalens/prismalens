// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	FolderGit2,
	GitBranch,
	Info,
	Link2,
	MoreHorizontal,
	Pencil,
	Search,
	type Server,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { DetailPage, PageHeader } from "@/components/layout";
import { DeleteServiceDialog } from "@/components/services/DeleteServiceDialog";
import { ServiceDependenciesTab } from "@/components/services/ServiceDependenciesTab";
import { ServiceDetailSkeleton } from "@/components/services/ServiceDetailSkeleton";
import { ServiceFormDialog } from "@/components/services/ServiceFormDialog";
import { ServiceIntegrationsTab } from "@/components/services/ServiceIntegrationsTab";
import { ServiceInvestigationTab } from "@/components/services/ServiceInvestigationTab";
import { ServiceOverviewTab } from "@/components/services/ServiceOverviewTab";
import { ServiceRepositoriesTab } from "@/components/services/ServiceRepositoriesTab";
import { tierLabels } from "@/components/services/service-detail.utils";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Mono } from "@/components/shared/Mono";
import { type ChipTone, StateChip } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	useRemoveServiceDependency,
	useServiceIntegrations,
} from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";

type ServiceTab =
	| "overview"
	| "repositories"
	| "integrations"
	| "investigation"
	| "dependencies";

const TABS: { value: ServiceTab; label: string; icon: typeof Server }[] = [
	{ value: "overview", label: "Overview", icon: Info },
	{ value: "repositories", label: "Repositories", icon: FolderGit2 },
	{ value: "integrations", label: "Integrations", icon: Link2 },
	{ value: "investigation", label: "Investigation", icon: Search },
	{ value: "dependencies", label: "Dependencies", icon: GitBranch },
];

const tierTones: Record<string, ChipTone> = {
	tier_1: "critical",
	tier_2: "high",
	tier_3: "medium",
	tier_4: "neutral",
};

export const Route = createFileRoute("/_authenticated/services/$id/")({
	validateSearch: (search: Record<string, unknown>) => ({
		tab: (TABS.some((t) => t.value === search.tab)
			? (search.tab as ServiceTab)
			: "overview") as ServiceTab,
	}),
	component: ServiceDetailPage,
});

function ServiceDetailPage() {
	const { id } = Route.useParams();
	const { tab } = Route.useSearch();
	const navigate = useNavigate({ from: "/services/$id/" });
	const [showEditDialog, setShowEditDialog] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [removingDepId, setRemovingDepId] = useState<string | null>(null);

	// Fetch service details
	const {
		data: service,
		isLoading,
		error,
		refetch,
	} = useQuery(orpc.services.get.queryOptions({ input: { id } }));

	// Fetch topology
	const { data: topology } = useQuery({
		...orpc.services.getTopology.queryOptions({ input: { id } }),
		enabled: !!service,
	});

	// Fetch service integrations
	const { data: integrations = [], isLoading: isLoadingIntegrations } =
		useServiceIntegrations(id);

	const removeDep = useRemoveServiceDependency();

	const handleRemoveDependency = () => {
		if (!removingDepId) return;
		removeDep.mutate(
			{ id, dependencyId: removingDepId },
			{
				onSuccess: () => {
					setRemovingDepId(null);
					refetch();
				},
			},
		);
	};

	if (isLoading) {
		return <ServiceDetailSkeleton />;
	}

	if (error || !service) {
		return (
			<div className="flex flex-col items-center justify-center py-12">
				<p className="text-lg font-medium text-destructive">
					Failed to load service
				</p>
				<p className="text-sm text-muted-foreground">
					{error?.message || "Service not found"}
				</p>
			</div>
		);
	}

	const header = (
		<PageHeader
			backLink={{ label: "Services", to: "/services" }}
			title={service.displayName || service.name}
			subtitle={
				<span className="flex items-center gap-2">
					<Mono className="text-muted-foreground">{service.name}</Mono>
					<StateChip tone={tierTones[service.tier] || "neutral"}>
						{tierLabels[service.tier] || service.tier}
					</StateChip>
					<StateChip tone="neutral" className="capitalize">
						{service.type}
					</StateChip>
					{service.team && <span>{service.team}</span>}
				</span>
			}
			actions={
				<>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setShowEditDialog(true)}
					>
						<Pencil className="h-4 w-4 mr-1" />
						Edit
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="outline" size="sm">
								<MoreHorizontal className="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem
								className="text-destructive"
								onClick={() => setShowDeleteDialog(true)}
							>
								<Trash2 className="h-4 w-4 mr-2" />
								Delete Service
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</>
			}
		/>
	);

	return (
		<>
			<DetailPage
				tabs={TABS}
				activeTab={tab}
				onTabChange={(t) => navigate({ search: { tab: t } })}
				header={header}
			>
				{tab === "overview" && (
					<ServiceOverviewTab
						service={service}
						topology={topology}
						integrations={integrations}
					/>
				)}
				{tab === "repositories" && (
					<ServiceRepositoriesTab serviceId={id} service={service} />
				)}
				{tab === "integrations" && (
					<ServiceIntegrationsTab
						serviceId={id}
						serviceType={service.type}
						integrations={integrations}
						isLoading={isLoadingIntegrations}
					/>
				)}
				{tab === "investigation" && (
					<ServiceInvestigationTab serviceId={id} metadata={service.metadata} />
				)}
				{tab === "dependencies" && (
					<ServiceDependenciesTab
						serviceId={id}
						topology={topology}
						onRemoveDependency={(depId) => setRemovingDepId(depId)}
						onRefresh={() => refetch()}
					/>
				)}
			</DetailPage>

			{/* Dialogs */}
			<ServiceFormDialog
				open={showEditDialog}
				onOpenChange={setShowEditDialog}
				service={service}
				onSuccess={() => refetch()}
			/>
			<DeleteServiceDialog
				open={showDeleteDialog}
				onOpenChange={setShowDeleteDialog}
				serviceId={service.id}
				serviceName={service.displayName || service.name}
				onSuccess={() => navigate({ to: "/services" })}
			/>
			<DestructiveConfirm
				open={!!removingDepId}
				onOpenChange={(open) => {
					if (!open) setRemovingDepId(null);
				}}
				title="Remove dependency?"
				description={
					<p>The edge between the two services goes; both services stay.</p>
				}
				confirmLabel="Remove"
				onConfirm={handleRemoveDependency}
				isPending={removeDep.isPending}
			/>
		</>
	);
}
