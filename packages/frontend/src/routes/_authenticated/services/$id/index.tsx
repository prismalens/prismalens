import { useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
	Box,
	Database,
	ExternalLink,
	GitBranch,
	Globe,
	Info,
	Link2,
	MoreHorizontal,
	Pencil,
	Plus,
	Search,
	Server,
	Trash2,
	Zap,
} from "lucide-react";
import type {
	ServiceIntegrationWithStatus,
	ServiceWithRelations,
	TopologyEdge,
} from "@prismalens/contracts";

import { orpc } from "@/lib/api/orpc-client";
import {
	useCreateServiceIntegration,
	useDeleteServiceIntegration,
	useGitOrganizations,
	useGitRepositories,
	useRemoveServiceDependency,
	useServiceIntegrations,
	useUpdateServiceIntegration,
} from "@/lib/api/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DetailPage, PageHeader } from "@/components/layout";
import { ServiceFormDialog } from "@/components/services/ServiceFormDialog";
import { DeleteServiceDialog } from "@/components/services/DeleteServiceDialog";
import { ServiceIntegrationsTab } from "@/components/services/ServiceIntegrationsTab";
import { ServiceIntegrationOverrideDialog } from "@/components/services/ServiceIntegrationOverrideDialog";
import { ServiceInvestigationTab } from "@/components/services/ServiceInvestigationTab";
import { AddDependencyDialog } from "@/components/services/AddDependencyDialog";
import { EditDependencyDialog } from "@/components/services/EditDependencyDialog";
import { MutationError } from "@/components/shared/MutationError";

type ServiceTab = "general" | "integrations" | "investigation" | "dependencies";

const TABS: { value: ServiceTab; label: string; icon: typeof Server }[] = [
	{ value: "general", label: "General", icon: Info },
	{ value: "integrations", label: "Integrations", icon: Link2 },
	{ value: "investigation", label: "Investigation", icon: Search },
	{ value: "dependencies", label: "Dependencies", icon: GitBranch },
];

export const Route = createFileRoute("/_authenticated/services/$id/")({
	validateSearch: (search: Record<string, unknown>) => ({
		tab: (TABS.some((t) => t.value === search.tab)
			? (search.tab as ServiceTab)
			: "general") as ServiceTab,
	}),
	component: ServiceDetailPage,
});

const serviceTypeIcons: Record<string, React.ReactNode> = {
	service: <Server className="h-5 w-5" />,
	database: <Database className="h-5 w-5" />,
	queue: <Zap className="h-5 w-5" />,
	cache: <Box className="h-5 w-5" />,
	gateway: <Globe className="h-5 w-5" />,
	external: <ExternalLink className="h-5 w-5" />,
	infrastructure: <Server className="h-5 w-5" />,
};

const tierLabels: Record<string, string> = {
	tier_1: "Critical",
	tier_2: "High",
	tier_3: "Medium",
	tier_4: "Low",
};

function ServiceDetailPage() {
	const { id } = Route.useParams();
	const { tab } = Route.useSearch();
	const navigate = useNavigate({ from: "/services/$id" });
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
	const [selectedOrg, setSelectedOrg] = useState<string | undefined>(
		undefined,
	);
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

	const existingDepIds =
		topology?.upstream?.map((d) => d.service.id) ?? [];

	const header = (
		<PageHeader
			backLink={{ label: "Services", to: "/services" }}
			title={service.displayName || service.name}
			subtitle={
				<span className="flex items-center gap-2">
					<span className="font-mono">{service.name}</span>
					<Badge variant="outline">{tierLabels[service.tier] || service.tier}</Badge>
					<Badge variant="secondary" className="capitalize">
						{service.type}
					</Badge>
					{service.team && (
						<span>{service.team}</span>
					)}
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
				{tab === "general" && <GeneralTab service={service} topology={topology} />}
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
					<ServiceInvestigationTab
						serviceId={id}
						metadata={service.metadata}
					/>
				)}
				{tab === "dependencies" && (
					<DependenciesTab
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

// =============================================================================
// General Tab
// =============================================================================

function GeneralTab({
	service,
	topology,
}: {
	service: ServiceWithRelations;
	topology?: {
		service: ServiceWithRelations;
		upstream: TopologyEdge[];
		downstream: TopologyEdge[];
	};
}) {
	return (
		<div className="grid gap-4 md:grid-cols-2">
			{/* Basic Info */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base">Basic Info</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2 text-sm">
					<div className="flex justify-between">
						<span className="text-muted-foreground">Type</span>
						<span className="capitalize">{service.type}</span>
					</div>
					<div className="flex justify-between">
						<span className="text-muted-foreground">Tier</span>
						<span>{tierLabels[service.tier] || service.tier}</span>
					</div>
					{service.team && (
						<div className="flex justify-between">
							<span className="text-muted-foreground">Team</span>
							<span>{service.team}</span>
						</div>
					)}
					{service.repository && (
						<div className="flex justify-between">
							<span className="text-muted-foreground">Repository</span>
							<a
								href={service.repository}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1 hover:text-primary truncate max-w-[200px]"
							>
								<GitBranch className="h-3 w-3 flex-shrink-0" />
								{service.repository.split("/").slice(-2).join("/")}
							</a>
						</div>
					)}
					{service.slackChannel && (
						<div className="flex justify-between">
							<span className="text-muted-foreground">Slack</span>
							<span className="font-mono">{service.slackChannel}</span>
						</div>
					)}
					{service.tags && service.tags.length > 0 && (
						<div className="flex justify-between items-start">
							<span className="text-muted-foreground">Tags</span>
							<div className="flex flex-wrap gap-1 justify-end">
								{service.tags.map((tag: string) => (
									<Badge key={tag} variant="secondary" className="text-xs">
										{tag}
									</Badge>
								))}
							</div>
						</div>
					)}
					<div className="flex justify-between">
						<span className="text-muted-foreground">Created</span>
						<span>{new Date(service.createdAt).toLocaleDateString()}</span>
					</div>
					<div className="flex justify-between">
						<span className="text-muted-foreground">Updated</span>
						<span>{new Date(service.updatedAt).toLocaleDateString()}</span>
					</div>
				</CardContent>
			</Card>

			{/* Stats */}
			<div className="space-y-4">
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Statistics</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2 text-sm">
						<div className="flex justify-between">
							<span className="text-muted-foreground">Active Alerts</span>
							<span className="font-medium">{service.alertCount ?? 0}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">Active Incidents</span>
							<span className="font-medium">
								{service.incidentCount ?? 0}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">Upstream Dependencies</span>
							<span className="font-medium">
								{topology?.upstream?.length ?? 0}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">Downstream Dependents</span>
							<span className="font-medium">
								{topology?.downstream?.length ?? 0}
							</span>
						</div>
					</CardContent>
				</Card>

				{service.description && (
					<Card>
						<CardHeader>
							<CardTitle className="text-base">Description</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-sm text-muted-foreground">
								{service.description}
							</p>
						</CardContent>
					</Card>
				)}
			</div>
		</div>
	);
}

// =============================================================================
// Dependencies Tab
// =============================================================================

function DependenciesTab({
	topology,
	onAddDependency,
	onEditDependency,
	onRemoveDependency,
}: {
	topology?: any;
	onAddDependency: () => void;
	onEditDependency: (dep: {
		dependencyId: string;
		name: string;
		type: string;
		criticality: string;
	}) => void;
	onRemoveDependency: (depId: string) => void;
}) {
	return (
		<div className="space-y-6">
			{/* Upstream Dependencies */}
			<div>
				<div className="flex items-center justify-between mb-3">
					<h3 className="text-sm font-medium">
						Upstream Dependencies ({topology?.upstream?.length ?? 0})
					</h3>
					<Button size="sm" variant="outline" onClick={onAddDependency}>
						<Plus className="h-4 w-4 mr-1" />
						Add Dependency
					</Button>
				</div>
				<div className="max-h-96 overflow-y-auto rounded-md border">
					{topology?.upstream && topology.upstream.length > 0 ? (
						<div className="divide-y">
							{topology.upstream.map((edge: any) => (
								<div
									key={edge.service.id}
									className="flex items-center justify-between p-3 hover:bg-muted/50"
								>
									<Link
										to="/services/$id"
										params={{ id: edge.service.id }}
										search={{ tab: "general" }}
										className="flex items-center gap-2 min-w-0 flex-1"
									>
										<div className="p-1 rounded bg-muted flex-shrink-0">
											{serviceTypeIcons[edge.service.type] || (
												<Server className="h-4 w-4" />
											)}
										</div>
										<div className="min-w-0">
											<p className="font-medium text-sm truncate">
												{edge.service.displayName || edge.service.name}
											</p>
											<p className="text-xs text-muted-foreground capitalize">
												{edge.service.type}
											</p>
										</div>
									</Link>
									<div className="flex items-center gap-2 flex-shrink-0">
										<Badge variant="outline" className="text-xs">
											{edge.dependencyType}
										</Badge>
										<Badge variant="secondary" className="text-xs">
											{edge.criticality}
										</Badge>
										<Button
											variant="ghost"
											size="sm"
											className="h-7 w-7 p-0"
											onClick={() =>
												onEditDependency({
													dependencyId: edge.service.id,
													name:
														edge.service.displayName || edge.service.name,
													type: edge.dependencyType,
													criticality: edge.criticality,
												})
											}
										>
											<Pencil className="h-3 w-3" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											className="h-7 w-7 p-0 text-destructive hover:text-destructive"
											onClick={() => onRemoveDependency(edge.service.id)}
										>
											<Trash2 className="h-3 w-3" />
										</Button>
									</div>
								</div>
							))}
						</div>
					) : (
						<p className="p-4 text-sm text-muted-foreground text-center">
							No upstream dependencies
						</p>
					)}
				</div>
			</div>

			{/* Downstream Dependents */}
			<div>
				<h3 className="text-sm font-medium mb-3">
					Downstream Dependents ({topology?.downstream?.length ?? 0})
				</h3>
				<div className="max-h-96 overflow-y-auto rounded-md border">
					{topology?.downstream && topology.downstream.length > 0 ? (
						<div className="divide-y">
							{topology.downstream.map((edge: any) => (
								<div
									key={edge.service.id}
									className="flex items-center justify-between p-3 hover:bg-muted/50"
								>
									<Link
										to="/services/$id"
										params={{ id: edge.service.id }}
										search={{ tab: "general" }}
										className="flex items-center gap-2 min-w-0 flex-1"
									>
										<div className="p-1 rounded bg-muted flex-shrink-0">
											{serviceTypeIcons[edge.service.type] || (
												<Server className="h-4 w-4" />
											)}
										</div>
										<div className="min-w-0">
											<p className="font-medium text-sm truncate">
												{edge.service.displayName || edge.service.name}
											</p>
											<p className="text-xs text-muted-foreground capitalize">
												{edge.service.type}
											</p>
										</div>
									</Link>
									<div className="flex items-center gap-2 flex-shrink-0">
										<Badge variant="outline" className="text-xs">
											{edge.dependencyType}
										</Badge>
										<Badge variant="secondary" className="text-xs">
											{edge.criticality}
										</Badge>
									</div>
								</div>
							))}
						</div>
					) : (
						<p className="p-4 text-sm text-muted-foreground text-center">
							No downstream dependents
						</p>
					)}
				</div>
			</div>

		</div>
	);
}

// =============================================================================
// Skeleton
// =============================================================================

function ServiceDetailSkeleton() {
	return (
		<div className="space-y-6">
			<Skeleton className="h-4 w-32" />
			<div className="flex items-start gap-3">
				<Skeleton className="h-10 w-10 rounded-lg" />
				<div className="space-y-2">
					<Skeleton className="h-8 w-64" />
					<Skeleton className="h-4 w-32" />
				</div>
			</div>
			<div className="flex gap-8">
				<Skeleton className="h-64 w-48" />
				<Skeleton className="h-64 flex-1" />
			</div>
		</div>
	);
}
