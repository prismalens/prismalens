// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { AuthTemplateResponse } from "@prismalens/contracts/schemas";
import {
	AlertCircle,
	CheckCircle,
	Link2,
	Loader2,
	Pencil,
	Plus,
	Sparkles,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	useConnections,
	useDeleteConnection,
	useTemplates,
	useTestConnection,
	useUpdateConnection,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { AddConnectionDialog } from "./AddConnectionDialog";
import { DeleteConnectionDialog } from "./DeleteConnectionDialog";
import { EditConnectionDialog } from "./EditConnectionDialog";
import { ConnectionStatusBadge, getTemplateIcon } from "./integration-utils";

export function ConnectionsTab() {
	const {
		data: connections,
		isLoading,
		refetch: refetchConnections,
	} = useConnections();
	const { data: templates } = useTemplates();
	const deleteConnection = useDeleteConnection();
	const updateConnection = useUpdateConnection();
	const testConnection = useTestConnection();

	// Dialogs
	const [showAddDialog, setShowAddDialog] = useState(false);
	const [showEditDialog, setShowEditDialog] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);

	// Selected state
	const [selectedConnectionId, setSelectedConnectionId] = useState<
		string | null
	>(null);
	const [credentialValues, setCredentialValues] = useState<
		Record<string, string>
	>({});
	const [connectionFieldValues, setConnectionFieldValues] = useState<
		Record<string, string>
	>({});
	const [showCredErrors, setShowCredErrors] = useState(false);
	const [editError, setEditError] = useState<Error | null>(null);
	const [deleteError, setDeleteError] = useState<Error | null>(null);

	// Test results
	const [testingConnectionId, setTestingConnectionId] = useState<string | null>(
		null,
	);
	const [testResults, setTestResults] = useState<
		Record<string, { success: boolean; error?: string }>
	>({});

	// Filters
	const [providerFilter, setProviderFilter] = useState<string>("all");
	const [statusFilter, setStatusFilter] = useState<string>("all");

	// OAuth callback handling
	const [oauthMessage, setOauthMessage] = useState<{
		type: "success" | "error";
		message: string;
	} | null>(null);

	useEffect(() => {
		if (typeof window === "undefined") return;

		const params = new URLSearchParams(window.location.search);
		const oauth = params.get("oauth");
		const status = params.get("status");
		const connectionId = params.get("connectionId");
		const error = params.get("error");
		const errorDescription = params.get("error_description");

		if (!oauth) return;

		const url = new URL(window.location.href);
		url.searchParams.delete("oauth");
		url.searchParams.delete("status");
		url.searchParams.delete("connectionId");
		url.searchParams.delete("error");
		url.searchParams.delete("error_description");
		window.history.replaceState({}, "", url.toString());

		if (status === "success" && connectionId) {
			setOauthMessage({
				type: "success",
				message: `Successfully connected to ${oauth}!`,
			});
			refetchConnections();
			setTimeout(() => setOauthMessage(null), 5000);
		} else if (status === "error") {
			setOauthMessage({
				type: "error",
				message: (
					errorDescription ||
					error ||
					`Failed to connect to ${oauth}`
				).slice(0, 200),
			});
			setTimeout(() => setOauthMessage(null), 10000);
		}
	}, [refetchConnections]);

	// --- Edit Connection ---
	const handleEditConnection = (connectionId: string) => {
		setSelectedConnectionId(connectionId);
		setCredentialValues({});
		setConnectionFieldValues({});
		setShowCredErrors(false);
		setEditError(null);
		setShowEditDialog(true);
	};

	const handleSaveEdit = async () => {
		if (!selectedConnectionId) return;
		setEditError(null);

		const connection = connections?.find((c) => c.id === selectedConnectionId);
		const template = templates?.find(
			(t: AuthTemplateResponse) => t.id === connection?.templateId,
		);

		// For OAuth redirect, re-trigger the OAuth flow
		if (template?.connectionCreationMode === "oauth_redirect") {
			try {
				const integrationId = connection?.integrationId;
				if (!integrationId) throw new Error("Integration not found");

				setShowEditDialog(false);
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
			} catch (err) {
				setEditError(
					err instanceof Error ? err : new Error("Failed to re-authorize"),
				);
			}
			return;
		}

		try {
			const hasNewCredentials = Object.values(credentialValues).some(
				(v) => v.trim() !== "",
			);
			await updateConnection.mutateAsync({
				id: selectedConnectionId,
				credentials: hasNewCredentials ? credentialValues : undefined,
				connectionConfig:
					Object.keys(connectionFieldValues).length > 0
						? connectionFieldValues
						: undefined,
			});
			setShowEditDialog(false);
			setSelectedConnectionId(null);
		} catch (err) {
			setEditError(
				err instanceof Error ? err : new Error("Failed to update connection"),
			);
		}
	};

	// --- Delete Connection ---
	const handleDelete = async () => {
		if (!selectedConnectionId) return;
		setDeleteError(null);
		try {
			await deleteConnection.mutateAsync({ id: selectedConnectionId });
			setShowDeleteDialog(false);
			setSelectedConnectionId(null);
		} catch (err) {
			setDeleteError(
				err instanceof Error ? err : new Error("Failed to delete connection"),
			);
		}
	};

	// --- Test Connection ---
	const handleTestConnection = async (connectionId: string) => {
		setTestingConnectionId(connectionId);
		try {
			const result = await testConnection.mutateAsync({
				id: connectionId,
			});
			setTestResults((prev) => ({
				...prev,
				[connectionId]: { success: result.success },
			}));
			await refetchConnections();
		} catch (err) {
			setTestResults((prev) => ({
				...prev,
				[connectionId]: {
					success: false,
					error: err instanceof Error ? err.message : "Test failed",
				},
			}));
		} finally {
			setTestingConnectionId(null);
		}
	};

	// --- Filter ---
	const uniqueTemplateIds = Array.from(
		new Set(connections?.map((c) => c.templateId).filter(Boolean)),
	);
	const filteredConnections = connections?.filter((c) => {
		if (providerFilter !== "all" && c.templateId !== providerFilter)
			return false;
		if (statusFilter !== "all" && c.status !== statusFilter) return false;
		return true;
	});

	// Edit dialog context
	const editConnection = connections?.find(
		(c) => c.id === selectedConnectionId,
	);
	const editTemplate = templates?.find(
		(t: AuthTemplateResponse) => t.id === editConnection?.templateId,
	);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-12">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* OAuth callback message */}
			{oauthMessage && (
				<div
					className={cn(
						"flex items-center gap-2 p-3 rounded-lg text-sm",
						oauthMessage.type === "success"
							? "bg-green-500/10 text-green-700 dark:text-green-400"
							: "bg-destructive/10 text-destructive",
					)}
				>
					{oauthMessage.type === "success" ? (
						<CheckCircle className="h-5 w-5" />
					) : (
						<AlertCircle className="h-5 w-5" />
					)}
					<span>{oauthMessage.message}</span>
				</div>
			)}

			{/* Connections Card */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Link2 className="h-5 w-5 text-muted-foreground" />
							<CardTitle>Connections</CardTitle>
						</div>
						<Button onClick={() => setShowAddDialog(true)}>
							<Plus className="h-4 w-4 mr-2" />
							Add Connection
						</Button>
					</div>
					<div className="flex items-center gap-3 pt-2">
						<Select value={providerFilter} onValueChange={setProviderFilter}>
							<SelectTrigger className="w-[180px]">
								<SelectValue placeholder="All providers" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All providers</SelectItem>
								{uniqueTemplateIds.map((tid) => {
									const t = templates?.find(
										(tmpl: AuthTemplateResponse) => tmpl.id === tid,
									);
									return (
										<SelectItem key={tid} value={tid ?? ""}>
											{t?.name ?? tid}
										</SelectItem>
									);
								})}
							</SelectContent>
						</Select>
						<Select value={statusFilter} onValueChange={setStatusFilter}>
							<SelectTrigger className="w-[180px]">
								<SelectValue placeholder="All statuses" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All statuses</SelectItem>
								<SelectItem value="ACTIVE">Active</SelectItem>
								<SelectItem value="TOKEN_EXPIRED">Token Expired</SelectItem>
								<SelectItem value="REFRESH_FAILED">Refresh Failed</SelectItem>
								<SelectItem value="CREDENTIALS_INVALID">
									Credentials Invalid
								</SelectItem>
								<SelectItem value="REVOKED">Revoked</SelectItem>
								<SelectItem value="ERROR">Error</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</CardHeader>
				<CardContent>
					{filteredConnections && filteredConnections.length > 0 ? (
						<div className="space-y-3">
							{filteredConnections.map((connection) => {
								const testResult = testResults[connection.id];

								return (
									<div
										key={connection.id}
										className="flex items-center justify-between p-4 border rounded-lg"
									>
										<div className="flex items-center gap-3">
											{getTemplateIcon(connection.templateId ?? "")}
											<div>
												<div className="flex items-center gap-2">
													<span className="font-medium">
														{connection.label ||
															(connection.integration?.label ??
																connection.templateName ??
																"Connection")}
													</span>
													<ConnectionStatusBadge status={connection.status} />
												</div>
												<p className="text-sm text-muted-foreground">
													{connection.templateName}
													{connection.integration
														? connection.integration.enabled
															? " • Enabled"
															: " • Disabled"
														: ""}
													{connection.lastRefreshedAt && (
														<>
															{" "}
															• Last refreshed:{" "}
															{new Date(
																connection.lastRefreshedAt,
															).toLocaleString()}
														</>
													)}
												</p>
												{connection.lastErrorMessage && (
													<p className="text-xs text-destructive mt-1">
														{connection.lastErrorMessage}
													</p>
												)}
												{testResult && (
													<p
														className={cn(
															"text-xs mt-1",
															testResult.success
																? "text-muted-foreground"
																: "text-destructive",
														)}
													>
														{testResult.success
															? "Connection test passed"
															: testResult.error}
													</p>
												)}
											</div>
										</div>
										<div className="flex items-center gap-2">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => handleTestConnection(connection.id)}
												disabled={testingConnectionId === connection.id}
											>
												{testingConnectionId === connection.id ? (
													<Loader2 className="h-4 w-4 animate-spin" />
												) : (
													<Sparkles className="h-4 w-4" />
												)}
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => handleEditConnection(connection.id)}
											>
												<Pencil className="h-4 w-4" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => {
													setSelectedConnectionId(connection.id);
													setDeleteError(null);
													setShowDeleteDialog(true);
												}}
											>
												<Trash2 className="h-4 w-4 text-destructive" />
											</Button>
										</div>
									</div>
								);
							})}
						</div>
					) : (
						<EmptyState
							icon={Link2}
							title={
								providerFilter !== "all" || statusFilter !== "all"
									? "No connections match filters"
									: "No connections yet"
							}
							description="Add a connection to an existing integration"
							actions={
								<Button onClick={() => setShowAddDialog(true)}>
									<Plus className="h-4 w-4 mr-2" />
									Add Connection
								</Button>
							}
						/>
					)}
				</CardContent>
			</Card>

			{/* Dialogs */}
			<AddConnectionDialog
				open={showAddDialog}
				onOpenChange={setShowAddDialog}
			/>

			<EditConnectionDialog
				open={showEditDialog}
				onOpenChange={(open) => {
					setShowEditDialog(open);
					if (!open) {
						setSelectedConnectionId(null);
						setCredentialValues({});
						setConnectionFieldValues({});
						setShowCredErrors(false);
						setEditError(null);
					}
				}}
				template={editTemplate}
				credentialValues={credentialValues}
				onCredentialValuesChange={setCredentialValues}
				connectionFieldValues={connectionFieldValues}
				onConnectionFieldValuesChange={setConnectionFieldValues}
				showErrors={showCredErrors}
				error={editError}
				onSave={handleSaveEdit}
				onCancel={() => {
					setShowEditDialog(false);
					setSelectedConnectionId(null);
				}}
				isSaving={updateConnection.isPending}
			/>

			<DeleteConnectionDialog
				open={showDeleteDialog}
				onOpenChange={setShowDeleteDialog}
				connectionId={selectedConnectionId}
				error={deleteError}
				onDelete={handleDelete}
				onCancel={() => {
					setShowDeleteDialog(false);
					setSelectedConnectionId(null);
					setDeleteError(null);
				}}
				isDeleting={deleteConnection.isPending}
			/>
		</div>
	);
}
