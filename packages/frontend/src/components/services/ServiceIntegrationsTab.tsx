"use client";

/**
 * Service Integrations Tab Component
 *
 * Displays integrations for a service, including:
 * - Global integrations (inherited from connection)
 * - Per-service overrides (custom config for this service)
 */

import {
	AlertCircle,
	Check,
	Github,
	Globe,
	Link2,
	Loader2,
	MessageSquare,
	Pencil,
	Plus,
	Settings2,
	Trash2,
	Zap,
} from "lucide-react";
import type { ServiceIntegrationWithStatus } from "@prismalens/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface ServiceIntegrationsTabProps {
	serviceId: string;
	serviceType: string;
	integrations: ServiceIntegrationWithStatus[];
	isLoading: boolean;
	onCreateOverride: (connectionId: string) => void;
	onEditOverride: (overrideId: string, integration: ServiceIntegrationWithStatus) => void;
	onDeleteOverride: (overrideId: string) => void;
}

// Integration icon helper
function getIntegrationIcon(definitionName: string) {
	switch (definitionName) {
		case "github":
			return <Github className="h-5 w-5" />;
		case "slack":
			return <MessageSquare className="h-5 w-5" />;
		case "prometheus":
			return <Zap className="h-5 w-5" />;
		default:
			return <Link2 className="h-5 w-5" />;
	}
}

// Connection status badge
function ConnectionStatusBadge({ status }: { status: string }) {
	switch (status) {
		case "connected":
			return (
				<Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
					<Check className="h-3 w-3 mr-1" />
					Connected
				</Badge>
			);
		case "error":
			return (
				<Badge variant="destructive">
					<AlertCircle className="h-3 w-3 mr-1" />
					Error
				</Badge>
			);
		case "pending":
			return (
				<Badge variant="secondary">
					<Loader2 className="h-3 w-3 mr-1 animate-spin" />
					Pending
				</Badge>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
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
								Inherited from connection-level settings
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
											{getIntegrationIcon(integration.definitionName)}
										</div>
										<div>
											<div className="flex items-center gap-2">
												<span className="font-medium">
													{integration.connectionName}
												</span>
												<ConnectionStatusBadge status={integration.status} />
											</div>
											<p className="text-sm text-muted-foreground">
												{integration.definitionDisplayName} •{" "}
												{integration.category}
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
						<div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center">
							<Settings2 className="h-5 w-5 text-orange-600 dark:text-orange-400" />
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
										"border-orange-200 dark:border-orange-900/50 bg-orange-50/50 dark:bg-orange-900/10",
									)}
								>
									<div className="flex items-center gap-3">
										<div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
											{getIntegrationIcon(integration.definitionName)}
										</div>
										<div>
											<div className="flex items-center gap-2">
												<span className="font-medium">
													{integration.connectionName}
												</span>
												<Badge
													variant="outline"
													className="text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700"
												>
													Override
												</Badge>
												<ConnectionStatusBadge status={integration.status} />
											</div>
											<p className="text-sm text-muted-foreground">
												{integration.definitionDisplayName} •{" "}
												{integration.category}
											</p>
											{/* Show override config summary */}
											{integration.serviceConfig && (
												<p className="text-xs text-muted-foreground mt-1">
													{summarizeConfig(
														integration.definitionName,
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
	definitionName: string,
	config: Record<string, unknown>,
): string {
	switch (definitionName) {
		case "github": {
			const repos = config.repositories as string[] | undefined;
			if (config.allRepositories) {
				return "All repositories";
			}
			if (repos?.length) {
				return `${repos.length} repositor${repos.length === 1 ? "y" : "ies"} selected`;
			}
			return "No repositories selected";
		}
		case "prometheus": {
			const labels = config.labels as Record<string, string> | undefined;
			if (labels && Object.keys(labels).length > 0) {
				return `Labels: ${Object.entries(labels)
					.map(([k, v]) => `${k}=${v}`)
					.join(", ")}`;
			}
			return "No label filters";
		}
		default:
			return JSON.stringify(config);
	}
}
