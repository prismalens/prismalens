// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ServiceWithRelations } from "@prismalens/contracts";
import { ExternalLink, Plus, Unlink } from "lucide-react";
import { useState } from "react";
import { MutationError } from "@/components/shared/MutationError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useUnlinkDeployment } from "@/lib/api/hooks";
import { LinkDeploymentDialog } from "./LinkDeploymentDialog";
import {
	DeploymentStatusIndicator,
	formatTimeAgo,
} from "./service-detail.utils";

interface ServiceDeploymentsTabProps {
	serviceId: string;
	service: ServiceWithRelations;
}

export function ServiceDeploymentsTab({
	serviceId,
	service,
}: ServiceDeploymentsTabProps) {
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
				<Button
					size="sm"
					variant="outline"
					onClick={() => setShowLinkDialog(true)}
				>
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
													["live", "active", "running"].includes(
														dep.status.toLowerCase(),
													)
														? "default"
														: ["suspended", "paused"].includes(
																	dep.status.toLowerCase(),
																)
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
											<span>
												Last deployed: {formatTimeAgo(dep.lastDeployedAt)}
											</span>
										)}
									</div>
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="text-destructive hover:text-destructive"
									disabled={unlinkDeploy.isPending}
									onClick={() => unlinkDeploy.mutate({ id: dep.id })}
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
