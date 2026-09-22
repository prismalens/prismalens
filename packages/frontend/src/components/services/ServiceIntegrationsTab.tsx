// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Service Integrations Tab Component
 *
 * Displays integrations for a service, including:
 * - Global integrations (inherited from connection)
 * - Per-service overrides (custom config for this service)
 */

import type { ServiceIntegrationWithStatus } from "@prismalens/contracts";
import {
	AlertCircle,
	Check,
	Globe,
	Link2,
	Loader2,
	Pencil,
	Plus,
	Settings2,
	Trash2,
} from "lucide-react";
import { StateChip } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getIntegrationIcon } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";

export interface ServiceIntegrationsTabProps {
	serviceId: string;
	serviceType: string;
	integrations: ServiceIntegrationWithStatus[];
	isLoading: boolean;
	onCreateOverride: (connectionId: string) => void;
	onEditOverride: (
		overrideId: string,
		integration: ServiceIntegrationWithStatus,
	) => void;
	onDeleteOverride: (overrideId: string) => void;
}

// Connection status badge
function ConnectionStatusBadge({ status }: { status: string }) {
	switch (status) {
		case "connected":
			return (
				<StateChip tone="done">
					<Check className="h-3 w-3 mr-1" />
					Connected
				</StateChip>
			);
		case "error":
			return (
				<StateChip tone="failed">
					<AlertCircle className="h-3 w-3 mr-1" />
					Error
				</StateChip>
			);
		case "pending":
			return (
				<StateChip tone="active">
					<Loader2 className="h-3 w-3 mr-1 animate-spin" />
					Pending
				</StateChip>
			);
		default:
			return <StateChip tone="neutral">{status}</StateChip>;
	}
}

// Service type display
const serviceTypeLabels: Record<string, string> = {
	service: "Backend Service",
	database: "Database",
	queue: "Message Queue",
	cache: "Cache",
	gateway: "API Gateway",
	external: "External Service",
	infrastructure: "Infrastructure",
};

export function ServiceIntegrationsTab({
	serviceType,
	integrations,
	isLoading,
	onCreateOverride,
	onEditOverride,
	onDeleteOverride,
}: ServiceIntegrationsTabProps) {
	if (isLoading) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-24" />
				<Skeleton className="h-24" />
				<Skeleton className="h-24" />
			</div>
		);
	}

	// Separate global integrations and service-specific overrides
	const globalIntegrations = integrations.filter((i) => !i.hasOverride);
	const overrides = integrations.filter((i) => i.hasOverride);

	return (
		<div className="space-y-6">
			{/* Service Type Info */}
			<Card>
				<CardHeader className="pb-3">
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
							<Settings2 className="h-5 w-5 text-muted-foreground" />
						</div>
						<div>
							<CardTitle className="text-base">Service Type</CardTitle>
							<CardDescription>
								{serviceTypeLabels[serviceType] || serviceType}
							</CardDescription>
						</div>
					</div>
				</CardHeader>
			</Card>

			{/* Global Integrations */}
			<Card>
				<CardHeader>
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
							<Globe className="h-5 w-5 text-primary" />
						</div>
						<div>
							<CardTitle className="text-base">Global Integrations</CardTitle>
							<CardDescription>
								Inherited from global integration settings
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{globalIntegrations.length === 0 ? (
						<div className="text-center py-6">
							<Link2 className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
							<p className="text-sm text-muted-foreground">
								No global integrations configured
							</p>
							<p className="text-xs text-muted-foreground mt-1">
								Add integrations in Settings to enable them for all services
							</p>
						</div>
					) : (
						<div className="space-y-3">
							{globalIntegrations.map((integration) => (
								<div
									key={integration.connectionId}
									className="flex items-center justify-between p-3 border rounded-lg"
								>
									<div className="flex items-center gap-3">
										<div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
											{getIntegrationIcon(integration.templateId)}
										</div>
										<div>
											<div className="flex items-center gap-2">
												<span className="font-medium">
													{integration.connectionName}
												</span>
												<ConnectionStatusBadge status={integration.status} />
											</div>
											<p className="text-sm text-muted-foreground">
												{integration.templateName} • {integration.category}
											</p>
										</div>
									</div>
									<Button
										variant="outline"
										size="sm"
										onClick={() => onCreateOverride(integration.connectionId)}
									>
										<Plus className="h-4 w-4 mr-1" />
										Override
									</Button>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Service-Specific Overrides */}
			<Card>
				<CardHeader>
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 bg-stale/12 rounded-lg flex items-center justify-center">
							<Settings2 className="h-5 w-5 text-stale" />
						</div>
						<div>
							<CardTitle className="text-base">
								Service-Specific Overrides
							</CardTitle>
							<CardDescription>
								Custom configuration for this service only
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{overrides.length === 0 ? (
						<div className="text-center py-6">
							<Settings2 className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
							<p className="text-sm text-muted-foreground">
								No service-specific overrides
							</p>
							<p className="text-xs text-muted-foreground mt-1">
								Click "Override" on a global integration to customize it for
								this service
							</p>
						</div>
					) : (
						<div className="space-y-3">
							{overrides.map((integration) => (
								<div
									key={integration.overrideId}
									className={cn(
										"flex items-center justify-between p-3 border rounded-lg",
										"border-stale/35 bg-stale/5",
									)}
								>
									<div className="flex items-center gap-3">
										<div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
											{getIntegrationIcon(integration.templateId)}
										</div>
										<div>
											<div className="flex items-center gap-2">
												<span className="font-medium">
													{integration.connectionName}
												</span>
												<StateChip tone="stale">Override</StateChip>
												<ConnectionStatusBadge status={integration.status} />
											</div>
											<p className="text-sm text-muted-foreground">
												{integration.templateName} • {integration.category}
											</p>
											{/* Show override config summary */}
											{integration.serviceConfig && (
												<p className="text-xs text-muted-foreground mt-1">
													{summarizeConfig(
														integration.templateId,
														integration.serviceConfig,
													)}
												</p>
											)}
										</div>
									</div>
									<div className="flex items-center gap-2">
										<Button
											variant="ghost"
											size="sm"
											aria-label="Edit override"
											onClick={() =>
												integration.overrideId &&
												onEditOverride(integration.overrideId, integration)
											}
										>
											<Pencil className="h-4 w-4" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											aria-label="Delete override"
											onClick={() =>
												integration.overrideId &&
												onDeleteOverride(integration.overrideId)
											}
										>
											<Trash2 className="h-4 w-4 text-destructive" />
										</Button>
									</div>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

// Summarize config for display
function summarizeConfig(
	templateId: string,
	config: Record<string, unknown>,
): string {
	if (templateId.startsWith("github")) {
		const repos = config.repositories as string[] | undefined;
		if (config.allRepositories) {
			return "All repositories";
		}
		if (repos?.length) {
			return `${repos.length} repositor${repos.length === 1 ? "y" : "ies"} selected`;
		}
		return "No repositories selected";
	}
	return JSON.stringify(config);
}
