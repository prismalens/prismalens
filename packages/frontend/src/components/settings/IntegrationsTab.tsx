// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type {
	AuthTemplateResponse,
	Integration,
} from "@prismalens/contracts/schemas";
import { useNavigate } from "@tanstack/react-router";
import {
	CheckCircle,
	Copy,
	Link2,
	Loader2,
	Pencil,
	Plus,
	Trash2,
	Zap,
} from "lucide-react";
import { useState } from "react";
import { Mono } from "@/components/shared/Mono";
import { StateChip } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import {
	useConnections,
	useDeleteIntegration,
	useIntegrations,
	useTemplates,
} from "@/lib/api/hooks";
import { DeleteIntegrationDialog } from "./DeleteIntegrationDialog";
import { IntegrationFormDialog } from "./IntegrationFormDialog";
import { getTemplateIcon } from "./integration-utils";

export function IntegrationsTab() {
	const { data: integrations, isLoading } = useIntegrations();
	const { data: connections } = useConnections();
	const { data: templates } = useTemplates();
	const deleteIntegration = useDeleteIntegration();
	const navigate = useNavigate();

	const [showAddDialog, setShowAddDialog] = useState(false);
	const [showEditDialog, setShowEditDialog] = useState(false);
	const [editTarget, setEditTarget] = useState<Integration | null>(null);

	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
	const [deleteError, setDeleteError] = useState<Error | null>(null);

	// Webhook URLs
	const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
	const webhookBaseUrl =
		typeof window !== "undefined"
			? `${window.location.origin}/api/webhooks`
			: "/api/webhooks";

	const handleCopyUrl = async (url: string, id: string) => {
		try {
			await navigator.clipboard.writeText(url);
			setCopiedUrl(id);
			setTimeout(() => setCopiedUrl(null), 2000);
		} catch {
			// Clipboard API may not be available
		}
	};

	// Count connections per integration
	const connectionCounts = new Map<string, number>();
	connections?.forEach((c) => {
		const count = connectionCounts.get(c.integrationId) ?? 0;
		connectionCounts.set(c.integrationId, count + 1);
	});

	const handleDelete = async () => {
		if (!deleteTargetId) return;
		setDeleteError(null);
		try {
			await deleteIntegration.mutateAsync({ id: deleteTargetId });
			setShowDeleteDialog(false);
			setDeleteTargetId(null);
		} catch (err) {
			setDeleteError(
				err instanceof Error ? err : new Error("Failed to delete integration"),
			);
		}
	};

	const handleCreated = async (
		integrationId: string,
		template: AuthTemplateResponse,
	) => {
		if (
			template.postCreationAction === "navigate" &&
			template.postCreationNavigateTo
		) {
			await navigate({
				to: template.postCreationNavigateTo,
				search: {
					integrationId,
					provider: template.id.split("-")[0],
					mode: template.id,
				},
			});
		}
		if (template.postCreationAction === "oauth_redirect") {
			try {
				const res = await fetch(
					`/api/integrations/oauth/${integrationId}/authorize`,
					{
						method: "POST",
						credentials: "include",
						headers: { "Content-Type": "application/json" },
					},
				);
				if (!res.ok) throw new Error(`OAuth authorize failed: ${res.status}`);
				const { redirectUrl } = await res.json();
				window.location.href = redirectUrl;
			} catch {
				// Integration was created, user can trigger OAuth from connections
			}
		}
	};

	const handleEditIntegration = (integration: Integration) => {
		setEditTarget(integration);
		setShowEditDialog(true);
	};

	const deleteTarget = integrations?.find((i) => i.id === deleteTargetId);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-12">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Webhook URLs */}
			<div className="rounded-lg border bg-card p-6 space-y-4">
				<div className="flex items-center gap-2">
					<Link2 className="h-5 w-5 text-muted-foreground" />
					<h3 className="text-base font-semibold">Webhook URLs</h3>
				</div>
				<p className="text-sm text-muted-foreground">
					Copy these URLs into your monitoring tools to send alerts to
					PrismaLens. Each delivery must send the webhook token as{" "}
					<Mono>Authorization: Bearer &lt;token&gt;</Mono> or as the basic auth
					password, or use it as the HMAC-SHA256 key over the raw body and send{" "}
					<Mono>X-Hub-Signature-256: sha256=&lt;hex digest&gt;</Mono>. The token
					is in <Mono>&lt;workspace&gt;/PRISMALENS_WEBHOOK_SECRET_FILE</Mono>;
					pl up prints the workspace path.
				</p>
				<div className="space-y-3">
					<div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
						<div className="flex items-center gap-3">
							<Zap className="h-5 w-5 text-muted-foreground" />
							<div>
								<p className="font-medium text-sm">Prometheus AlertManager</p>
								<Mono className="text-xs text-muted-foreground break-all">
									{webhookBaseUrl}/prometheus
								</Mono>
							</div>
						</div>
						<Button
							variant="ghost"
							size="sm"
							onClick={() =>
								handleCopyUrl(`${webhookBaseUrl}/prometheus`, "prometheus")
							}
						>
							{copiedUrl === "prometheus" ? (
								<CheckCircle className="h-4 w-4 text-muted-foreground" />
							) : (
								<Copy className="h-4 w-4" />
							)}
						</Button>
					</div>

					<div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
						<div className="flex items-center gap-3">
							<Link2 className="h-5 w-5 text-muted-foreground" />
							<div>
								<p className="font-medium text-sm">Generic Webhook</p>
								<Mono className="text-xs text-muted-foreground break-all">
									{webhookBaseUrl}/generic
								</Mono>
							</div>
						</div>
						<Button
							variant="ghost"
							size="sm"
							onClick={() =>
								handleCopyUrl(`${webhookBaseUrl}/generic`, "generic")
							}
						>
							{copiedUrl === "generic" ? (
								<CheckCircle className="h-4 w-4 text-muted-foreground" />
							) : (
								<Copy className="h-4 w-4" />
							)}
						</Button>
					</div>
				</div>
			</div>

			{/* Integrations List */}
			<div className="rounded-lg border bg-card p-6 space-y-4">
				<div className="flex items-center justify-between">
					<h3 className="text-base font-semibold">Integrations</h3>
					<Button onClick={() => setShowAddDialog(true)}>
						<Plus className="h-4 w-4 mr-2" />
						Add Integration
					</Button>
				</div>
				<p className="text-sm text-muted-foreground">
					Register external service providers. Connections are managed in the
					Connections tab.
				</p>

				{integrations && integrations.length > 0 ? (
					<div className="border rounded-lg overflow-hidden">
						<table className="w-full">
							<thead>
								<tr className="border-b bg-muted/50">
									<th className="text-left text-sm font-medium text-muted-foreground px-4 py-3">
										Provider
									</th>
									<th className="text-left text-sm font-medium text-muted-foreground px-4 py-3">
										Label
									</th>
									<th className="text-left text-sm font-medium text-muted-foreground px-4 py-3">
										Auth mode
									</th>
									<th className="text-center text-sm font-medium text-muted-foreground px-4 py-3">
										Connections
									</th>
									<th className="text-right text-sm font-medium text-muted-foreground px-4 py-3">
										Actions
									</th>
								</tr>
							</thead>
							<tbody>
								{integrations.map((integration) => {
									const template = templates?.find(
										(t) => t.id === integration.templateId,
									);
									const connCount = connectionCounts.get(integration.id) ?? 0;

									return (
										<tr
											key={integration.id}
											className="border-b last:border-b-0"
										>
											<td className="px-4 py-3">
												<div className="flex items-center gap-2">
													<span className="text-muted-foreground">
														{getTemplateIcon(integration.templateId)}
													</span>
													<span className="font-medium text-sm">
														{template?.name ?? integration.templateId}
													</span>
												</div>
											</td>
											<td className="px-4 py-3 text-sm">{integration.label}</td>
											<td className="px-4 py-3">
												<StateChip tone="neutral">
													{template?.authModeLabel ?? "—"}
												</StateChip>
											</td>
											<td className="px-4 py-3 text-center text-sm">
												<Mono>{connCount}</Mono>
											</td>
											<td className="px-4 py-3 text-right">
												<div className="flex items-center justify-end gap-1">
													<Button
														variant="ghost"
														size="sm"
														onClick={() => handleEditIntegration(integration)}
													>
														<Pencil className="h-4 w-4" />
													</Button>
													<Button
														variant="ghost"
														size="sm"
														onClick={() => {
															setDeleteTargetId(integration.id);
															setDeleteError(null);
															setShowDeleteDialog(true);
														}}
													>
														<Trash2 className="h-4 w-4 text-destructive" />
													</Button>
												</div>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				) : (
					<div
						className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed p-4"
						data-testid="integrations-empty"
					>
						<p className="text-record text-muted-foreground">
							No integrations registered yet.
						</p>
						<Button onClick={() => setShowAddDialog(true)}>
							<Plus className="h-4 w-4 mr-2" />
							Add Integration
						</Button>
					</div>
				)}
			</div>

			{/* Form dialog for create and edit */}
			<IntegrationFormDialog
				open={showAddDialog}
				onOpenChange={setShowAddDialog}
				mode="create"
				onCreated={handleCreated}
			/>

			<IntegrationFormDialog
				open={showEditDialog}
				onOpenChange={(open) => {
					setShowEditDialog(open);
					if (!open) setEditTarget(null);
				}}
				mode="edit"
				integration={editTarget}
			/>

			<DeleteIntegrationDialog
				open={showDeleteDialog}
				onOpenChange={setShowDeleteDialog}
				integrationId={deleteTargetId}
				integrationLabel={deleteTarget?.label}
				error={deleteError}
				onDelete={handleDelete}
				onCancel={() => {
					setShowDeleteDialog(false);
					setDeleteTargetId(null);
					setDeleteError(null);
				}}
				isDeleting={deleteIntegration.isPending}
			/>
		</div>
	);
}
