import type { ServiceIntegrationWithStatus } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	FolderGit2,
	GitBranch,
	Info,
	Link2,
	MoreHorizontal,
	Pencil,
	Rocket,
	Search,
	type Server,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { DetailPage, PageHeader } from "@/components/layout";
import { AddDependencyDialog } from "@/components/services/AddDependencyDialog";
import { DeleteServiceDialog } from "@/components/services/DeleteServiceDialog";
import { EditDependencyDialog } from "@/components/services/EditDependencyDialog";
import { ServiceDependenciesTab } from "@/components/services/ServiceDependenciesTab";
import { ServiceDeploymentsTab } from "@/components/services/ServiceDeploymentsTab";
import { ServiceDetailSkeleton } from "@/components/services/ServiceDetailSkeleton";
import { ServiceFormDialog } from "@/components/services/ServiceFormDialog";
import { ServiceIntegrationOverrideDialog } from "@/components/services/ServiceIntegrationOverrideDialog";
import { ServiceIntegrationsTab } from "@/components/services/ServiceIntegrationsTab";
import { ServiceInvestigationTab } from "@/components/services/ServiceInvestigationTab";
import { ServiceOverviewTab } from "@/components/services/ServiceOverviewTab";
import { ServiceRepositoriesTab } from "@/components/services/ServiceRepositoriesTab";
import { tierLabels } from "@/components/services/service-detail.utils";
import { MutationError } from "@/components/shared/MutationError";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	useCreateServiceIntegration,
	useDeleteServiceIntegration,
	useGitOrganizations,
	useGitRepositories,
	useRemoveServiceDependency,
	useServiceIntegrations,
	useUpdateServiceIntegration,
} from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";

type ServiceTab =
	| "overview"
	| "repositories"
	| "deployments"
	| "integrations"
	| "investigation"
	| "dependencies";

const TABS: { value: ServiceTab; label: string; icon: typeof Server }[] = [
	{ value: "overview", label: "Overview", icon: Info },
	{ value: "repositories", label: "Repositories", icon: FolderGit2 },
	{ value: "deployments", label: "Deployments", icon: Rocket },
	{ value: "integrations", label: "Integrations", icon: Link2 },
	{ value: "investigation", label: "Investigation", icon: Search },
	{ value: "dependencies", label: "Dependencies", icon: GitBranch },
];

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
	const [showAddDepDialog, setShowAddDepDialog] = useState(false);
	const [showOverrideDialog, setShowOverrideDialog] = useState(false);
	const [selectedIntegration, setSelectedIntegration] =
		useState<ServiceIntegrationWithStatus | null>(null);
	const [selectedConnectionId, setSelectedConnectionId] = useState<
		string | null
	>(null);
	const [editingOverrideId, setEditingOverrideId] = useState<string | null>(
		null,
	);
	const [selectedOrg, setSelectedOrg] = useState<string | undefined>(undefined);
	const [editingDep, setEditingDep] = useState<{
		dependencyId: string;
		name: string;
		type: string;
		criticality: string;
	} | null>(null);
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

	// Git provider data for override dialog
	const isGitHubIntegration =
		selectedIntegration?.templateId?.startsWith("github") ?? false;
	const { data: organizations = [], isLoading: isLoadingOrgs } =
		useGitOrganizations(
			isGitHubIntegration && selectedIntegration
				? selectedIntegration.connectionId
				: "",
		);
	const { data: repositories = [], isLoading: isLoadingRepos } =
		useGitRepositories(
			isGitHubIntegration && selectedIntegration
				? selectedIntegration.connectionId
				: "",
			selectedOrg,
		);

	// Service integration mutations
	const createOverride = useCreateServiceIntegration();
	const updateOverride = useUpdateServiceIntegration();
	const deleteOverride = useDeleteServiceIntegration();
	const removeDep = useRemoveServiceDependency();

	// Integration override handlers
	const handleCreateOverride = (connectionId: string) => {
		const integration = integrations.find(
			(i) => i.connectionId === connectionId,
		);
		if (integration) {
			setSelectedIntegration(integration);
			setSelectedConnectionId(connectionId);
			setEditingOverrideId(null);
			setSelectedOrg(undefined);
			setShowOverrideDialog(true);
		}
	};

	const handleEditOverride = (
		overrideId: string,
		integration: ServiceIntegrationWithStatus,
	) => {
		setSelectedIntegration(integration);
		setEditingOverrideId(overrideId);
		setSelectedConnectionId(integration.connectionId);
		const config = integration.serviceConfig as {
			organization?: string;
		} | null;
		setSelectedOrg(config?.organization);
		setShowOverrideDialog(true);
	};

	const handleDeleteOverride = (overrideId: string) => {
		deleteOverride.mutate({ id: overrideId });
	};

	const handleSaveOverride = (config: Record<string, unknown>) => {
		if (editingOverrideId) {
			updateOverride.mutate(
				{ id: editingOverrideId, config },
				{
					onSuccess: () => {
						setShowOverrideDialog(false);
						resetOverrideState();
					},
				},
			);
		} else if (selectedConnectionId) {
			createOverride.mutate(
				{ serviceId: id, connectionId: selectedConnectionId, config },
				{
					onSuccess: () => {
						setShowOverrideDialog(false);
						resetOverrideState();
					},
				},
			);
		}
	};

	const resetOverrideState = () => {
		setSelectedIntegration(null);
		setSelectedConnectionId(null);
		setEditingOverrideId(null);
		setSelectedOrg(undefined);
	};

	const handleRemoveDependency = () => {
		if (!removingDepId) return;
		removeDep.mutate(
			{ id, dependencyId: removingDepId },
			{
				onSuccess: () => setRemovingDepId(null),
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

	const existingDepIds = topology?.upstream?.map((d) => d.service.id) ?? [];

	const header = (
		<PageHeader
			backLink={{ label: "Services", to: "/services" }}
			title={service.displayName || service.name}
			subtitle={
				<span className="flex items-center gap-2">
					<span className="font-mono">{service.name}</span>
					<Badge variant="outline">
						{tierLabels[service.tier] || service.tier}
					</Badge>
					<Badge variant="secondary" className="capitalize">
						{service.type}
					</Badge>
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
				{tab === "deployments" && (
					<ServiceDeploymentsTab serviceId={id} service={service} />
				)}
				{tab === "integrations" && (
					<>
						<MutationError error={deleteOverride.error} className="mb-4" />
						<ServiceIntegrationsTab
							serviceId={id}
							serviceType={service.type}
							integrations={integrations}
							isLoading={isLoadingIntegrations}
							onCreateOverride={handleCreateOverride}
							onEditOverride={handleEditOverride}
							onDeleteOverride={handleDeleteOverride}
						/>
					</>
				)}
				{tab === "investigation" && (
					<ServiceInvestigationTab serviceId={id} metadata={service.metadata} />
				)}
				{tab === "dependencies" && (
					<ServiceDependenciesTab
						topology={topology}
						onAddDependency={() => setShowAddDepDialog(true)}
						onEditDependency={(dep) => setEditingDep(dep)}
						onRemoveDependency={(depId) => setRemovingDepId(depId)}
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
			<AddDependencyDialog
				open={showAddDepDialog}
				onOpenChange={setShowAddDepDialog}
				serviceId={id}
				existingDependencyIds={existingDepIds}
			/>
			{editingDep && (
				<EditDependencyDialog
					open={!!editingDep}
					onOpenChange={(open) => {
						if (!open) setEditingDep(null);
					}}
					serviceId={id}
					dependencyId={editingDep.dependencyId}
					dependencyName={editingDep.name}
					currentType={editingDep.type}
					currentCriticality={editingDep.criticality}
				/>
			)}
			<AlertDialog
				open={!!removingDepId}
				onOpenChange={(open) => {
					if (!open) setRemovingDepId(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove Dependency</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to remove this dependency? This action
							cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleRemoveDependency}>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<ServiceIntegrationOverrideDialog
				open={showOverrideDialog}
				onOpenChange={(open) => {
					setShowOverrideDialog(open);
					if (!open) resetOverrideState();
				}}
				serviceId={id}
				serviceName={service.displayName || service.name}
				overrideId={editingOverrideId ?? undefined}
				integration={selectedIntegration ?? undefined}
				connectionId={selectedConnectionId ?? undefined}
				organizations={organizations}
				repositories={repositories}
				isLoadingOrgs={isLoadingOrgs}
				isLoadingRepos={isLoadingRepos}
				selectedOrg={selectedOrg}
				onOrgChange={setSelectedOrg}
				onSave={handleSaveOverride}
				isSaving={createOverride.isPending || updateOverride.isPending}
			/>
		</>
	);
}
