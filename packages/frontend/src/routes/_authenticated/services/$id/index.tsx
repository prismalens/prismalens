import { useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
	ArrowLeft,
	Box,
	Database,
	ExternalLink,
	GitBranch,
	Globe,
	Link2,
	Pencil,
	Server,
	Settings,
	Trash2,
	Zap,
} from "lucide-react";
import type { ServiceIntegrationWithStatus } from "@prismalens/contracts";

import { orpc } from "@/lib/api/orpc-client";
import {
	useCreateServiceIntegration,
	useDeleteServiceIntegration,
	useGitOrganizations,
	useGitRepositories,
	useServiceIntegrations,
	useUpdateServiceIntegration,
} from "@/lib/api/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ServiceFormDialog } from "@/components/services/ServiceFormDialog";
import { DeleteServiceDialog } from "@/components/services/DeleteServiceDialog";
import { ServiceIntegrationsTab } from "@/components/services/ServiceIntegrationsTab";
import { ServiceIntegrationOverrideDialog } from "@/components/services/ServiceIntegrationOverrideDialog";

export const Route = createFileRoute("/_authenticated/services/$id/")({
	component: ServiceDetailPage,
});

const serviceTypeIcons: Record<string, React.ReactNode> = {
	service: <Server className="h-6 w-6" />,
	database: <Database className="h-6 w-6" />,
	queue: <Zap className="h-6 w-6" />,
	cache: <Box className="h-6 w-6" />,
	gateway: <Globe className="h-6 w-6" />,
	external: <ExternalLink className="h-6 w-6" />,
	infrastructure: <Server className="h-6 w-6" />,
};

const tierColors: Record<string, string> = {
	tier_1: "bg-red-500 text-white",
	tier_2: "bg-orange-500 text-white",
	tier_3: "bg-yellow-500 text-black",
	tier_4: "bg-gray-500 text-white",
};

const tierLabels: Record<string, string> = {
	tier_1: "Tier 1 - Critical",
	tier_2: "Tier 2 - High",
	tier_3: "Tier 3 - Medium",
	tier_4: "Tier 4 - Low",
};

function ServiceDetailPage() {
	const { id } = Route.useParams();
	const navigate = useNavigate();
	const [showEditDialog, setShowEditDialog] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [showOverrideDialog, setShowOverrideDialog] = useState(false);
	const [selectedIntegration, setSelectedIntegration] = useState<ServiceIntegrationWithStatus | null>(null);
	const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
	const [editingOverrideId, setEditingOverrideId] = useState<string | null>(null);
	const [selectedOrg, setSelectedOrg] = useState<string | undefined>(undefined);

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
	const { data: integrations = [], isLoading: isLoadingIntegrations } = useServiceIntegrations(id);

	// Git provider data for override dialog (only fetch when dialog is open for github integration)
	const isGitHubIntegration = selectedIntegration?.templateId?.startsWith("github") ?? false;
	const { data: organizations = [], isLoading: isLoadingOrgs } = useGitOrganizations(
		isGitHubIntegration && selectedIntegration ? selectedIntegration.connectionId : "",
	);
	const { data: repositories = [], isLoading: isLoadingRepos } = useGitRepositories(
		isGitHubIntegration && selectedIntegration ? selectedIntegration.connectionId : "",
		selectedOrg,
	);

	// Service integration mutations
	const createOverride = useCreateServiceIntegration();
	const updateOverride = useUpdateServiceIntegration();
	const deleteOverride = useDeleteServiceIntegration();

	// Handle create override
	const handleCreateOverride = (connectionId: string) => {
		const integration = integrations.find((i) => i.connectionId === connectionId);
		if (integration) {
			setSelectedIntegration(integration);
			setSelectedConnectionId(connectionId);
			setEditingOverrideId(null);
			setSelectedOrg(undefined);
			setShowOverrideDialog(true);
		}
	};

	// Handle edit override
	const handleEditOverride = (overrideId: string, integration: ServiceIntegrationWithStatus) => {
		setSelectedIntegration(integration);
		setEditingOverrideId(overrideId);
		setSelectedConnectionId(integration.connectionId);
		// Initialize org from existing config
		const config = integration.serviceConfig as { organization?: string } | null;
		setSelectedOrg(config?.organization);
		setShowOverrideDialog(true);
	};

	// Handle delete override
	const handleDeleteOverride = (overrideId: string) => {
		deleteOverride.mutate(
			{ id: overrideId },
			{
				onError: (err) => {
					console.error("Failed to delete override:", err);
				},
			},
		);
	};

	// Handle save override
	const handleSaveOverride = (config: Record<string, unknown>) => {
		if (editingOverrideId) {
			// Update existing
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
			// Create new
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
	}

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
		)
	}

	const typeIcon = serviceTypeIcons[service.type] || serviceTypeIcons.service;

	return (
		<div className="space-y-6">
			{/* Back link */}
			<Link
				to="/services"
				className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft className="h-4 w-4" />
				Back to Services
			</Link>

			{/* Header */}
			<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
				<div className="flex items-start gap-4">
					<div className="p-3 rounded-lg bg-muted">{typeIcon}</div>
					<div className="space-y-2">
						<div className="flex items-center gap-3">
							<h1 className="text-2xl font-bold">
								{service.displayName || service.name}
							</h1>
							<Badge className={tierColors[service.tier] || "bg-gray-500"}>
								{tierLabels[service.tier] || service.tier}
							</Badge>
						</div>
						<p className="text-sm font-mono text-muted-foreground">
							{service.name}
						</p>
						{service.description && (
							<p className="text-muted-foreground max-w-2xl">
								{service.description}
							</p>
						)}
						<div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
							<Badge variant="outline" className="capitalize">
								{service.type}
							</Badge>
							{service.team && <span>Team: {service.team}</span>}
							{service.repository && (
								<a
									href={service.repository}
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center gap-1 hover:text-primary"
								>
									<GitBranch className="h-4 w-4" />
									Repository
								</a>
							)}
						</div>
					</div>
				</div>
			</div>

			{/* Tabs */}
			<Tabs defaultValue="overview" className="space-y-4">
				<TabsList>
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="dependencies">Dependencies</TabsTrigger>
					<TabsTrigger value="integrations">
						<Link2 className="h-4 w-4 mr-1" />
						Integrations
					</TabsTrigger>
					<TabsTrigger value="settings">
						<Settings className="h-4 w-4 mr-1" />
						Settings
					</TabsTrigger>
				</TabsList>

				<TabsContent value="overview">
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						{/* Stats Card */}
						<Card>
							<CardHeader>
								<CardTitle className="text-base">Statistics</CardTitle>
							</CardHeader>
							<CardContent className="space-y-2">
								<div className="flex justify-between">
									<span className="text-muted-foreground">Active Alerts</span>
									<span className="font-medium">
										{service.alertCount ?? 0}
									</span>
								</div>
								<div className="flex justify-between">
									<span className="text-muted-foreground">Active Incidents</span>
									<span className="font-medium">
										{service.incidentCount ?? 0}
									</span>
								</div>
								<div className="flex justify-between">
									<span className="text-muted-foreground">Dependencies</span>
									<span className="font-medium">
										{service.dependencies?.length ?? 0}
									</span>
								</div>
								<div className="flex justify-between">
									<span className="text-muted-foreground">Dependents</span>
									<span className="font-medium">
										{service.dependents?.length ?? 0}
									</span>
								</div>
							</CardContent>
						</Card>

						{/* Tags Card */}
						<Card>
							<CardHeader>
								<CardTitle className="text-base">Tags</CardTitle>
							</CardHeader>
							<CardContent>
								{service.tags && service.tags.length > 0 ? (
									<div className="flex flex-wrap gap-2">
										{service.tags.map((tag) => (
											<Badge key={tag} variant="secondary">
												{tag}
											</Badge>
										))}
									</div>
								) : (
									<p className="text-sm text-muted-foreground">No tags</p>
								)}
							</CardContent>
						</Card>

						{/* Metadata Card */}
						<Card>
							<CardHeader>
								<CardTitle className="text-base">Information</CardTitle>
							</CardHeader>
							<CardContent className="space-y-2 text-sm">
								{service.slackChannel && (
									<div className="flex justify-between">
										<span className="text-muted-foreground">Slack</span>
										<span className="font-mono">{service.slackChannel}</span>
									</div>
								)}
								<div className="flex justify-between">
									<span className="text-muted-foreground">Discovered</span>
									<span>{service.isDiscovered ? "Yes" : "No"}</span>
								</div>
								<div className="flex justify-between">
									<span className="text-muted-foreground">Confirmed</span>
									<span>{service.isConfirmed ? "Yes" : "No"}</span>
								</div>
								<div className="flex justify-between">
									<span className="text-muted-foreground">Created</span>
									<span>
										{new Date(service.createdAt).toLocaleDateString()}
									</span>
								</div>
							</CardContent>
						</Card>
					</div>
				</TabsContent>

				<TabsContent value="dependencies">
					<div className="grid gap-6 md:grid-cols-2">
						{/* Upstream Dependencies */}
						<Card>
							<CardHeader>
								<CardTitle className="text-base">
									Upstream Dependencies ({topology?.upstream?.length ?? 0})
								</CardTitle>
							</CardHeader>
							<CardContent>
								{topology?.upstream && topology.upstream.length > 0 ? (
									<div className="space-y-2">
										{topology.upstream.map((dep) => (
											<Link
												key={dep.id}
												to="/services/$id"
												params={{ id: dep.id }}
												className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted"
											>
												<div className="p-1 rounded bg-muted">
													{serviceTypeIcons[dep.type] || <Server className="h-4 w-4" />}
												</div>
												<div>
													<p className="font-medium">{dep.displayName || dep.name}</p>
													<p className="text-xs text-muted-foreground capitalize">
														{dep.type} - {dep.tier.replace("_", " ")}
													</p>
												</div>
											</Link>
										))}
									</div>
								) : (
									<p className="text-sm text-muted-foreground">
										No upstream dependencies
									</p>
								)}
							</CardContent>
						</Card>

						{/* Downstream Dependents */}
						<Card>
							<CardHeader>
								<CardTitle className="text-base">
									Downstream Dependents ({topology?.downstream?.length ?? 0})
								</CardTitle>
							</CardHeader>
							<CardContent>
								{topology?.downstream && topology.downstream.length > 0 ? (
									<div className="space-y-2">
										{topology.downstream.map((dep) => (
											<Link
												key={dep.id}
												to="/services/$id"
												params={{ id: dep.id }}
												className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted"
											>
												<div className="p-1 rounded bg-muted">
													{serviceTypeIcons[dep.type] || <Server className="h-4 w-4" />}
												</div>
												<div>
													<p className="font-medium">{dep.displayName || dep.name}</p>
													<p className="text-xs text-muted-foreground capitalize">
														{dep.type} - {dep.tier.replace("_", " ")}
													</p>
												</div>
											</Link>
										))}
									</div>
								) : (
									<p className="text-sm text-muted-foreground">
										No downstream dependents
									</p>
								)}
							</CardContent>
						</Card>
					</div>
				</TabsContent>

				<TabsContent value="integrations">
					<ServiceIntegrationsTab
						serviceId={id}
						serviceType={service.type}
						integrations={integrations}
						isLoading={isLoadingIntegrations}
						onCreateOverride={handleCreateOverride}
						onEditOverride={handleEditOverride}
						onDeleteOverride={handleDeleteOverride}
					/>
				</TabsContent>

				<TabsContent value="settings">
					<div className="space-y-6">
						{/* Edit Service */}
						<Card>
							<CardHeader>
								<CardTitle className="text-base">Edit Service</CardTitle>
								<CardDescription>
									Update service information, tier, team, and other metadata.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<Button onClick={() => setShowEditDialog(true)}>
									<Pencil className="h-4 w-4 mr-2" />
									Edit Service
								</Button>
							</CardContent>
						</Card>

						{/* Danger Zone */}
						<Card className="border-destructive/50">
							<CardHeader>
								<CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
								<CardDescription>
									Permanently delete this service from the catalog. This action cannot be undone.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<Button
									variant="destructive"
									onClick={() => setShowDeleteDialog(true)}
								>
									<Trash2 className="h-4 w-4 mr-2" />
									Delete Service
								</Button>
							</CardContent>
						</Card>
					</div>
				</TabsContent>
			</Tabs>

			{/* Edit Service Dialog */}
			<ServiceFormDialog
				open={showEditDialog}
				onOpenChange={setShowEditDialog}
				service={service}
				onSuccess={() => refetch()}
			/>

			{/* Delete Service Dialog */}
			<DeleteServiceDialog
				open={showDeleteDialog}
				onOpenChange={setShowDeleteDialog}
				serviceId={service.id}
				serviceName={service.displayName || service.name}
				onSuccess={() => navigate({ to: "/services" })}
			/>

			{/* Service Integration Override Dialog */}
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
		</div>
	)
}

function ServiceDetailSkeleton() {
	return (
		<div className="space-y-6">
			<Skeleton className="h-4 w-32" />
			<div className="flex items-start gap-4">
				<Skeleton className="h-14 w-14 rounded-lg" />
				<div className="space-y-2">
					<Skeleton className="h-8 w-64" />
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-4 w-96" />
				</div>
			</div>
			<Skeleton className="h-10 w-96" />
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				<Skeleton className="h-48" />
				<Skeleton className="h-48" />
				<Skeleton className="h-48" />
			</div>
		</div>
	)
}
