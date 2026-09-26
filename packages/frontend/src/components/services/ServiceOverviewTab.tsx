// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	ServiceIntegrationWithStatus,
	ServiceWithRelations,
	TopologyEdge,
} from "@prismalens/contracts";
import { FolderGit2, GitBranch, Link2 } from "lucide-react";

import { Mono } from "@/components/shared/Mono";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format-time";
import { tierLabels } from "./service-detail.utils";

interface ServiceOverviewTabProps {
	service: ServiceWithRelations;
	topology?: {
		service: ServiceWithRelations;
		upstream: TopologyEdge[];
		downstream: TopologyEdge[];
	};
	integrations: ServiceIntegrationWithStatus[];
}

export function ServiceOverviewTab({
	service,
	topology,
	integrations,
}: ServiceOverviewTabProps) {
	const repos = service.repositories ?? [];

	return (
		<div className="grid gap-4 md:grid-cols-2">
			{/* Basic Info */}
			<Card>
				<CardHeader>
					<CardTitle>Basic info</CardTitle>
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
						<span>
							<span className="tabular-nums">
								{formatDate(service.createdAt)}
							</span>
						</span>
					</div>
					<div className="flex justify-between">
						<span className="text-muted-foreground">Updated</span>
						<span>
							<span className="tabular-nums">
								{formatDate(service.updatedAt)}
							</span>
						</span>
					</div>
				</CardContent>
			</Card>

			{/* Stats */}
			<div className="space-y-4">
				<Card>
					<CardHeader>
						<CardTitle>Statistics</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2 text-sm">
						<div className="flex justify-between">
							<span className="text-muted-foreground">Active alerts</span>
							<span className="font-medium">{service.alertCount ?? 0}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">Active incidents</span>
							<span className="font-medium">{service.incidentCount ?? 0}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">
								Upstream dependencies
							</span>
							<span className="font-medium">
								{topology?.upstream?.length ?? 0}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">
								Downstream dependents
							</span>
							<span className="font-medium">
								{topology?.downstream?.length ?? 0}
							</span>
						</div>
					</CardContent>
				</Card>

				{service.description && (
					<Card>
						<CardHeader>
							<CardTitle>Description</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-record text-muted-foreground">
								{service.description}
							</p>
						</CardContent>
					</Card>
				)}
			</div>

			{/* Repositories Summary */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<FolderGit2 className="h-4 w-4" />
						Repositories ({repos.length})
					</CardTitle>
				</CardHeader>
				<CardContent>
					{repos.length > 0 ? (
						<div className="space-y-1 text-sm">
							{repos.map((sr) => (
								<div key={sr.id} className="space-y-0.5">
									<div className="flex items-center gap-2">
										<GitBranch className="h-3 w-3 text-muted-foreground flex-shrink-0" />
										<span className="truncate" title={sr.repository.url}>
											{sr.repository.fullName}
										</span>
										{sr.isPrimary && (
											<Badge variant="default" className="text-xs">
												PRIMARY
											</Badge>
										)}
									</div>
									{sr.repository.syncError ? (
										<p
											className="pl-5 font-mono text-xs text-destructive break-words"
											data-testid="repository-sync-error"
										>
											{sr.repository.syncError}
										</p>
									) : sr.repository.syncHead ? (
										<p
											className="pl-5 font-mono text-xs text-muted-foreground"
											data-testid="repository-sync-head"
										>
											{sr.repository.syncBranch ?? "detached"} at{" "}
											{sr.repository.syncHead.slice(0, 12)}
										</p>
									) : null}
								</div>
							))}
						</div>
					) : (
						<p className="text-record text-muted-foreground">
							No linked repositories
						</p>
					)}
				</CardContent>
			</Card>

			{/* Integrations Summary */}
			{integrations.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Link2 className="h-4 w-4" />
							Integrations ({integrations.length})
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="space-y-1 text-sm">
							{integrations.map((integ) => (
								<div
									key={integ.connectionId}
									className="flex items-center gap-2"
								>
									<span className="truncate">{integ.templateId}</span>
									<Badge
										variant={
											integ.status === "ACTIVE" ? "default" : "secondary"
										}
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
