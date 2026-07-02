"use client";

import type { AuthTemplateResponse } from "@prismalens/contracts/schemas";
import { useNavigate } from "@tanstack/react-router";
import {
	CheckCircle,
	Copy,
	Link2,
	Loader2,
	Pencil,
	Plus,
	Settings2,
	Trash2,
	Zap,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
	useConnections,
	useDeleteIntegration,
	useIntegrations,
	useTemplates,
	useUpdateIntegration,
} from "@/lib/api/hooks";
import { AddIntegrationDialog } from "./AddIntegrationDialog";
import { DeleteIntegrationDialog } from "./DeleteIntegrationDialog";
import { EditIntegrationDialog } from "./EditIntegrationDialog";
import { getTemplateIcon } from "./integration-utils";

export function IntegrationsTab() {
	const { data: integrations, isLoading } = useIntegrations();
	const { data: connections } = useConnections();
	const { data: templates } = useTemplates();
	const deleteIntegration = useDeleteIntegration();
	const updateIntegration = useUpdateIntegration();
	const navigate = useNavigate();

	const [showAddDialog, setShowAddDialog] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
	const [deleteError, setDeleteError] = useState<Error | null>(null);

	// Edit state
	const [showEditDialog, setShowEditDialog] = useState(false);
	const [editTargetId, setEditTargetId] = useState<string | null>(null);
	const [editLabel, setEditLabel] = useState("");
	const [editCredentialValues, setEditCredentialValues] = useState<
		Record<string, string>
	>({});
	const [showEditErrors, setShowEditErrors] = useState(false);
	const [editError, setEditError] = useState<Error | null>(null);

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

	// --- Edit Integration ---
	const handleEditIntegration = (integrationId: string) => {
		const integration = integrations?.find((i) => i.id === integrationId);
		if (!integration) return;
		setEditTargetId(integrationId);
		setEditLabel(integration.label);
		setEditCredentialValues({});
		setShowEditErrors(false);
		setEditError(null);
		setShowEditDialog(true);
	};

	const handleSaveEdit = async () => {
		if (!editTargetId) return;
		setEditError(null);

		const integration = integrations?.find((i) => i.id === editTargetId);
		const template = templates?.find(
			(t: AuthTemplateResponse) => t.id === integration?.templateId,
		);

		if (!editLabel.trim()) {
			setShowEditErrors(true);
			return;
		}

		try {
			const hasNewCredentials = Object.values(editCredentialValues).some(
				(v) => v.trim() !== "",
			);

			let clientId: string | undefined;
			let clientSecret: string | undefined;

			if (hasNewCredentials && template) {
				if (template.connectionCreationMode === "oauth_redirect") {
					clientId = editCredentialValues.clientId || undefined;
					clientSecret = editCredentialValues.clientSecret || undefined;
				} else if ((template.integrationCredentialFields?.length ?? 0) > 0) {
					clientId = editCredentialValues.appId || undefined;
					const privateKey = editCredentialValues.privateKey;
					const webhookSecret = editCredentialValues.webhookSecret;
					if (privateKey) {
						clientSecret = JSON.stringify({
							privateKey,
							...(webhookSecret ? { webhookSecret } : {}),
						});
					}
				}
			}

			await updateIntegration.mutateAsync({
				id: editTargetId,
				label: editLabel,
				clientId,
				clientSecret,
			});
			setShowEditDialog(false);
			setEditTargetId(null);
		} catch (err) {
			setEditError(
				err instanceof Error ? err : new Error("Failed to update integration"),
			);
		}
	};

	const editIntegration = integrations?.find((i) => i.id === editTargetId);
	const editTemplate = templates?.find(
		(t: AuthTemplateResponse) => t.id === editIntegration?.templateId,
	);

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
			<Card>
				<CardHeader>
					<div className="flex items-center gap-2">
						<Link2 className="h-5 w-5 text-muted-foreground" />
						<CardTitle>Webhook URLs</CardTitle>
					</div>
					<p className="text-sm text-muted-foreground">
						Copy these URLs into your monitoring tools to send alerts to
						PrismaLens.
					</p>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
						<div className="flex items-center gap-3">
							<Zap className="h-5 w-5 text-muted-foreground" />
							<div>
								<p className="font-medium text-sm">Prometheus AlertManager</p>
								<code className="text-xs text-muted-foreground break-all">
									{webhookBaseUrl}/prometheus
								</code>
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
								<code className="text-xs text-muted-foreground break-all">
									{webhookBaseUrl}/generic
								</code>
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
				</CardContent>
			</Card>

			{/* Integrations List */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Settings2 className="h-5 w-5 text-muted-foreground" />
							<CardTitle>Integrations</CardTitle>
						</div>
						<Button onClick={() => setShowAddDialog(true)}>
							<Plus className="h-4 w-4 mr-2" />
							Add Integration
						</Button>
					</div>
					<p className="text-sm text-muted-foreground">
						Register external service providers. Connections are managed in the
						Connections tab.
					</p>
				</CardHeader>
				<CardContent>
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
											Auth Mode
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
												<td className="px-4 py-3 text-sm">
													{integration.label}
												</td>
												<td className="px-4 py-3">
													<Badge variant="outline">
														{template?.authModeLabel ?? "—"}
													</Badge>
												</td>
												<td className="px-4 py-3 text-center text-sm">
													{connCount}
												</td>
												<td className="px-4 py-3 text-right">
													<div className="flex items-center justify-end gap-1">
														<Button
															variant="ghost"
															size="sm"
															onClick={() =>
																handleEditIntegration(integration.id)
															}
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
						<EmptyState
							icon={Settings2}
							title="No integrations registered"
							description="Add a provider to get started"
							actions={
								<Button onClick={() => setShowAddDialog(true)}>
									<Plus className="h-4 w-4 mr-2" />
									Add Integration
								</Button>
							}
						/>
					)}
				</CardContent>
			</Card>

			{/* Dialogs */}
			<AddIntegrationDialog
				open={showAddDialog}
				onOpenChange={setShowAddDialog}
				onCreated={handleCreated}
			/>

			<EditIntegrationDialog
				open={showEditDialog}
				onOpenChange={(open) => {
					setShowEditDialog(open);
					if (!open) {
						setEditTargetId(null);
						setEditCredentialValues({});
						setShowEditErrors(false);
						setEditError(null);
					}
				}}
				template={editTemplate}
				label={editLabel}
				onLabelChange={setEditLabel}
				credentialValues={editCredentialValues}
				onCredentialValuesChange={setEditCredentialValues}
				showErrors={showEditErrors}
				error={editError}
				onSave={handleSaveEdit}
				onCancel={() => {
					setShowEditDialog(false);
					setEditTargetId(null);
				}}
				isSaving={updateIntegration.isPending}
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
