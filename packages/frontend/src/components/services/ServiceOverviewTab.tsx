import { FolderGit2, GitBranch, Link2, Rocket } from "lucide-react";
import type {
	ServiceIntegrationWithStatus,
	ServiceWithRelations,
	TopologyEdge,
} from "@prismalens/contracts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeploymentStatusIndicator, tierLabels } from "./service-detail.utils";

interface ServiceOverviewTabProps {
	service: ServiceWithRelations;
	topology?: {
		service: ServiceWithRelations;
		upstream: TopologyEdge[];
		downstream: TopologyEdge[];
	};
	integrations: ServiceIntegrationWithStatus[];
}

export function ServiceOverviewTab({ service, topology, integrations }: ServiceOverviewTabProps) {
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
										variant={integ.status === "ACTIVE" ? "default" : "secondary"}
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
