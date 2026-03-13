import { useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
	Box,
	Cloud,
	Database,
	ExternalLink,
	FolderGit2,
	GitBranch,
	Globe,
	Info,
	Link2,
	MoreHorizontal,
	Pencil,
	Plus,
	Rocket,
	Search,
	Server,
	Trash2,
	Unlink,
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
	useUnlinkDeployment,
	useUnlinkRepository,
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
import { LinkRepositoryDialog } from "@/components/services/LinkRepositoryDialog";
import { LinkDeploymentDialog } from "@/components/services/LinkDeploymentDialog";
import { MutationError } from "@/components/shared/MutationError";

type ServiceTab = "overview" | "repositories" | "deployments" | "integrations" | "investigation" | "dependencies";

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
				{tab === "overview" && <OverviewTab service={service} topology={topology} integrations={integrations} />}
				{tab === "repositories" && (
					<RepositoriesTab serviceId={id} service={service} />
				)}
				{tab === "deployments" && (
					<DeploymentsTab serviceId={id} service={service} />
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
// Overview Tab
// =============================================================================

function OverviewTab({
	service,
	topology,
	integrations,
}: {
	service: ServiceWithRelations;
	topology?: {
		service: ServiceWithRelations;
		upstream: TopologyEdge[];
		downstream: TopologyEdge[];
	};
	integrations: ServiceIntegrationWithStatus[];
}) {
	const repos = service.repositories ?? [];
	const deploys = service.deployments ?? [];

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

			{/* Repositories Summary */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<FolderGit2 className="h-4 w-4" />
						Repositories ({repos.length})
					</CardTitle>
				</CardHeader>
				<CardContent>
					{repos.length > 0 ? (
						<div className="space-y-1 text-sm">
							{repos.map((sr) => (
								<div key={sr.id} className="flex items-center gap-2">
									<GitBranch className="h-3 w-3 text-muted-foreground flex-shrink-0" />
									<span className="truncate">{sr.repository.fullName}</span>
									{sr.isPrimary && (
										<Badge variant="default" className="text-xs">PRIMARY</Badge>
									)}
								</div>
							))}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">No linked repositories</p>
					)}
				</CardContent>
			</Card>

			{/* Deployments Summary */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Rocket className="h-4 w-4" />
						Deployments ({deploys.length})
					</CardTitle>
				</CardHeader>
				<CardContent>
					{deploys.length > 0 ? (
						<div className="space-y-1 text-sm">
							{deploys.map((dep) => (
								<div key={dep.id} className="flex items-center gap-2">
									<DeploymentStatusIndicator status={dep.status} />
									<span className="truncate">{dep.name}</span>
									{dep.status && (
										<Badge variant="outline" className="text-xs capitalize">
											{dep.status}
										</Badge>
									)}
								</div>
							))}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">No linked deployments</p>
					)}
				</CardContent>
			</Card>

			{/* Integrations Summary */}
			{integrations.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-base flex items-center gap-2">
							<Link2 className="h-4 w-4" />
							Integrations ({integrations.length})
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="space-y-1 text-sm">
							{integrations.map((integ) => (
								<div key={integ.connectionId} className="flex items-center gap-2">
									<span className="truncate">{integ.templateId}</span>
									<Badge
										variant={integ.status === "active" ? "default" : "secondary"}
										className="text-xs capitalize"
									>
										{integ.status}
									</Badge>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}

// =============================================================================
// Repositories Tab
// =============================================================================

function RepositoriesTab({
	serviceId,
	service,
}: {
	serviceId: string;
	service: ServiceWithRelations;
}) {
	const [showLinkDialog, setShowLinkDialog] = useState(false);
	const repos = service.repositories ?? [];
	const unlinkRepo = useUnlinkRepository();
	const linkedRepoIds = repos.map((sr) => sr.repositoryId);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium">
					Linked Repositories ({repos.length})
				</h3>
				<Button size="sm" variant="outline" onClick={() => setShowLinkDialog(true)}>
					<Plus className="h-4 w-4 mr-1" />
					Link Repository
				</Button>
			</div>

			<MutationError error={unlinkRepo.error} className="mb-4" />

			<div className="rounded-md border">
				{repos.length > 0 ? (
					<div className="divide-y">
						{repos.map((sr) => (
							<div
								key={sr.id}
								className="flex items-center justify-between p-4 hover:bg-muted/50"
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<FolderGit2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
										<span className="font-medium text-sm truncate">
											{sr.repository.fullName}
										</span>
										{sr.isPrimary && (
											<Badge variant="default" className="text-xs">PRIMARY</Badge>
										)}
									</div>
									<div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
										{sr.repository.language && (
											<span>{sr.repository.language}</span>
										)}
										{sr.repository.defaultBranch && (
											<span className="flex items-center gap-1">
												<GitBranch className="h-3 w-3" />
												{sr.repository.defaultBranch}
											</span>
										)}
										{sr.subPath && (
											<span className="font-mono">/{sr.subPath}</span>
										)}
									</div>
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="text-destructive hover:text-destructive"
									disabled={unlinkRepo.isPending}
									onClick={() =>
										unlinkRepo.mutate({
											id: sr.repositoryId,
											serviceId,
										})
									}
								>
									<Unlink className="h-4 w-4 mr-1" />
									Unlink
								</Button>
							</div>
						))}
					</div>
				) : (
					<p className="p-4 text-sm text-muted-foreground text-center">
						No repositories linked to this service
					</p>
				)}
			</div>

			<LinkRepositoryDialog
				open={showLinkDialog}
				onOpenChange={setShowLinkDialog}
				serviceId={serviceId}
				linkedRepositoryIds={linkedRepoIds}
			/>
		</div>
	);
}

// =============================================================================
// Deployments Tab
// =============================================================================

function DeploymentStatusIndicator({ status }: { status: string | null }) {
	const colors: Record<string, string> = {
		live: "text-green-500",
		active: "text-green-500",
		running: "text-green-500",
		suspended: "text-yellow-500",
		paused: "text-yellow-500",
		stopped: "text-red-500",
		failed: "text-red-500",
		error: "text-red-500",
	};
	const colorClass = status ? (colors[status.toLowerCase()] ?? "text-muted-foreground") : "text-muted-foreground";
	return <Cloud className={`h-3 w-3 flex-shrink-0 ${colorClass}`} />;
}

function formatTimeAgo(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 30) return `${diffDays}d ago`;
	return date.toLocaleDateString();
}

function DeploymentsTab({
	serviceId,
	service,
}: {
	serviceId: string;
	service: ServiceWithRelations;
}) {
	const [showLinkDialog, setShowLinkDialog] = useState(false);
	const deploys = service.deployments ?? [];
	const unlinkDeploy = useUnlinkDeployment();
	const linkedDeployIds = deploys.map((d) => d.id);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium">
					Linked Deployments ({deploys.length})
				</h3>
				<Button size="sm" variant="outline" onClick={() => setShowLinkDialog(true)}>
					<Plus className="h-4 w-4 mr-1" />
					Link Deployment
				</Button>
			</div>

			<MutationError error={unlinkDeploy.error} className="mb-4" />

			<div className="rounded-md border">
				{deploys.length > 0 ? (
					<div className="divide-y">
						{deploys.map((dep) => (
							<div
								key={dep.id}
								className="flex items-center justify-between p-4 hover:bg-muted/50"
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<DeploymentStatusIndicator status={dep.status} />
										<span className="font-medium text-sm truncate">
											{dep.name}
										</span>
										{dep.status && (
											<Badge
												variant={
													["live", "active", "running"].includes(dep.status.toLowerCase())
														? "default"
														: ["suspended", "paused"].includes(dep.status.toLowerCase())
															? "secondary"
															: "destructive"
												}
												className="text-xs capitalize"
											>
												{dep.status}
											</Badge>
										)}
									</div>
									<div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
										{dep.deploymentType && (
											<span className="capitalize">{dep.deploymentType}</span>
										)}
										{dep.region && <span>{dep.region}</span>}
										{dep.url && (
											<a
												href={dep.url}
												target="_blank"
												rel="noopener noreferrer"
												className="flex items-center gap-1 hover:text-primary"
											>
												<ExternalLink className="h-3 w-3" />
												{dep.url}
											</a>
										)}
										{dep.lastDeployedAt && (
											<span>Last deployed: {formatTimeAgo(dep.lastDeployedAt)}</span>
										)}
									</div>
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="text-destructive hover:text-destructive"
									disabled={unlinkDeploy.isPending}
									onClick={() =>
										unlinkDeploy.mutate({ id: dep.id })
									}
								>
									<Unlink className="h-4 w-4 mr-1" />
									Unlink
								</Button>
							</div>
						))}
					</div>
				) : (
					<p className="p-4 text-sm text-muted-foreground text-center">
						No deployments linked to this service
					</p>
				)}
			</div>

			<LinkDeploymentDialog
				open={showLinkDialog}
				onOpenChange={setShowLinkDialog}
				serviceId={serviceId}
				linkedDeploymentIds={linkedDeployIds}
			/>
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
										search={{ tab: "overview" }}
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
										search={{ tab: "overview" }}
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
