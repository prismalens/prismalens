// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { ServiceIntegrationWithStatus } from "@prismalens/contracts";
import { AlertCircle, Check, Link2, Loader2 } from "lucide-react";
import { RecordSection } from "@/components/shared/RecordSection";
import { StateChip } from "@/components/shared/StateChip";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	useCreateServiceIntegration,
	useDeleteServiceIntegration,
	useUpdateServiceIntegration,
} from "@/lib/api/hooks";
import { getIntegrationIcon } from "@/lib/integration-icons";

export interface ServiceIntegrationsTabProps {
	serviceId: string;
	serviceType: string;
	integrations: ServiceIntegrationWithStatus[];
	isLoading: boolean;
}

// Connection status badge
function ConnectionStatusBadge({ status }: { status: string }) {
	switch (status) {
		case "connected":
			return (
				<StateChip tone="done">
					<Check className="h-3 w-3 mr-1" />
					connected
				</StateChip>
			);
		case "error":
			return (
				<StateChip tone="failed">
					<AlertCircle className="h-3 w-3 mr-1" />
					error
				</StateChip>
			);
		case "pending":
			return (
				<StateChip tone="active">
					<Loader2 className="h-3 w-3 mr-1 animate-spin" />
					pending
				</StateChip>
			);
		default:
			return <StateChip tone="neutral">{status.toLowerCase()}</StateChip>;
	}
}

export function ServiceIntegrationsTab({
	serviceId,
	integrations,
	isLoading,
}: ServiceIntegrationsTabProps) {
	const createOverride = useCreateServiceIntegration();
	const updateOverride = useUpdateServiceIntegration();
	const deleteOverride = useDeleteServiceIntegration();

	if (isLoading) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-20" />
				<Skeleton className="h-20" />
			</div>
		);
	}

	const handleSettingChange = async (
		integration: ServiceIntegrationWithStatus,
		nextSetting: "inherit" | "on" | "off",
	) => {
		if (nextSetting === "inherit") {
			if (integration.overrideId) {
				deleteOverride.mutate({ id: integration.overrideId });
			}
		} else if (nextSetting === "on") {
			if (integration.overrideId) {
				updateOverride.mutate({
					id: integration.overrideId,
					config: { ...(integration.serviceConfig as object), enabled: true },
				});
			} else {
				createOverride.mutate({
					serviceId,
					connectionId: integration.connectionId,
					config: { enabled: true },
				});
			}
		} else if (nextSetting === "off") {
			if (integration.overrideId) {
				updateOverride.mutate({
					id: integration.overrideId,
					config: { ...(integration.serviceConfig as object), enabled: false },
				});
			} else {
				createOverride.mutate({
					serviceId,
					connectionId: integration.connectionId,
					config: { enabled: false },
				});
			}
		}
	};

	return (
		<div className="space-y-6">
			<RecordSection id="what-a-run-can-see" title="What a run can see">
				{integrations.length === 0 ? (
					<div className="p-4 rounded-md border border-dashed text-center">
						<Link2 className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
						<p className="text-sm text-muted-foreground">
							No integrations configured
						</p>
					</div>
				) : (
					<div className="space-y-3">
						{integrations.map((integration) => {
							const effectiveSetting: "inherit" | "on" | "off" =
								!integration.hasOverride
									? "inherit"
									: (integration.serviceConfig as { enabled?: boolean })
												?.enabled === false
										? "off"
										: "on";

							const tone =
								effectiveSetting === "on"
									? "done"
									: effectiveSetting === "off"
										? "failed"
										: "neutral";

							return (
								<div
									key={integration.connectionId}
									className="flex items-center justify-between p-3 border rounded-lg bg-card"
								>
									<div className="flex items-center gap-3">
										<div className="w-9 h-9 bg-muted rounded-lg flex items-center justify-center">
											{getIntegrationIcon(integration.templateId)}
										</div>
										<div>
											<div className="flex items-center gap-2">
												<span className="font-medium text-sm">
													{integration.connectionName}
												</span>
												<StateChip tone={tone}>{effectiveSetting}</StateChip>
												<ConnectionStatusBadge status={integration.status} />
											</div>
											<p className="text-xs text-muted-foreground">
												{integration.templateName} • {integration.category}
											</p>
										</div>
									</div>

									<div className="flex items-center gap-2">
										<Select
											value={effectiveSetting}
											onValueChange={(val) =>
												handleSettingChange(
													integration,
													val as "inherit" | "on" | "off",
												)
											}
											disabled={
												createOverride.isPending ||
												updateOverride.isPending ||
												deleteOverride.isPending
											}
										>
											<SelectTrigger className="w-28 h-8 text-xs">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="inherit">Inherit</SelectItem>
												<SelectItem value="on">On</SelectItem>
												<SelectItem value="off">Off</SelectItem>
											</SelectContent>
										</Select>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</RecordSection>
		</div>
	);
}
