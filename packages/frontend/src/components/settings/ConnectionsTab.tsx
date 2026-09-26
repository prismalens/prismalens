// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type {
	AuthTemplateResponse,
	ConnectionWithIntegration,
} from "@prismalens/contracts/schemas";
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
import { Mono } from "@/components/shared/Mono";
import { Button } from "@/components/ui/button";
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
} from "@/lib/api/hooks";
import { formatDateTime } from "@/lib/format-time";
import { cn } from "@/lib/utils";
import { ConnectionFormDialog } from "./ConnectionFormDialog";
import { DeleteConnectionDialog } from "./DeleteConnectionDialog";
import { ConnectionStatusBadge, getTemplateIcon } from "./integration-utils";

export function ConnectionsTab() {
	const {
		data: connections,
		isLoading,
		refetch: refetchConnections,
	} = useConnections();
	const { data: templates } = useTemplates();
	const deleteConnection = useDeleteConnection();
	const testConnection = useTestConnection();

	// Dialogs
	const [showAddDialog, setShowAddDialog] = useState(false);
	const [showEditDialog, setShowEditDialog] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);

	// Selected state
	const [selectedConnection, setSelectedConnection] =
		useState<ConnectionWithIntegration | null>(null);
	const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
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
		if (typeof window !== "undefined") {
			const params = new URLSearchParams(window.location.search);
			const oauth = params.get("oauth");
			const status = params.get("status");
			const connectionId = params.get("connectionId");
			const error = params.get("error");
			const errorDescription = params.get("error_description");

			if (!oauth) return;

			if (status === "success") {
				setOauthMessage({
					type: "success",
					message: connectionId
						? `OAuth connection established successfully (ID: ${connectionId})`
						: "OAuth connection established successfully",
				});
				refetchConnections();
			} else if (status === "error" || error) {
				setOauthMessage({
					type: "error",
					message:
						errorDescription ||
						error ||
						"OAuth authorization failed. Please try again.",
				});
			}

			const timer = setTimeout(() => {
				setOauthMessage(null);
			}, 10000);

			return () => clearTimeout(timer);
		}
	}, [refetchConnections]);

	// Filter connections
	const hasAny = (connections?.length ?? 0) > 0;
	const filteredConnections = connections?.filter((conn) => {
		if (providerFilter !== "all" && conn.templateId !== providerFilter) {
			return false;
		}
		if (statusFilter !== "all" && conn.status !== statusFilter) {
			return false;
		}
		return true;
	});

	// Get unique template IDs for provider filter
	const uniqueTemplateIds = Array.from(
		new Set(connections?.map((c) => c.templateId).filter(Boolean)),
	);

	// --- Edit Connection ---
	const handleEditConnection = (connection: ConnectionWithIntegration) => {
		setSelectedConnection(connection);
		setShowEditDialog(true);
	};

	// --- Delete Connection ---
	const handleDelete = async () => {
		if (!deleteTargetId) return;
		setDeleteError(null);
		try {
			await deleteConnection.mutateAsync({ id: deleteTargetId });
			setShowDeleteDialog(false);
			setDeleteTargetId(null);
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
		} catch (err) {
			setTestResults((prev) => ({
				...prev,
				[connectionId]: {
					success: false,
					error: err instanceof Error ? err.message : "Connection test failed",
				},
			}));
		} finally {
			setTestingConnectionId(null);
		}
	};

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-12">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* OAuth Feedback Banner */}
			{oauthMessage && (
				<div
					className={cn(
						"flex items-center gap-2 p-4 rounded-lg border text-record",
						oauthMessage.type === "success"
							? "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/50 dark:border-green-800 dark:text-green-200"
							: "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/50 dark:border-red-800 dark:text-red-200",
					)}
				>
					{oauthMessage.type === "success" ? (
						<CheckCircle className="h-4 w-4 shrink-0" />
					) : (
						<AlertCircle className="h-4 w-4 shrink-0" />
					)}
					<span>{oauthMessage.message}</span>
				</div>
			)}

			{/* Connections Section */}
			<div className="rounded-md border bg-card p-4 space-y-4">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Link2 className="h-5 w-5 text-muted-foreground" />
						<h3 className="text-sm font-semibold tracking-tight">
							Connections
						</h3>
					</div>
					{/* With none yet, the empty state carries the only Add button. */}
					{hasAny && (
						<Button onClick={() => setShowAddDialog(true)}>
							<Plus className="h-4 w-4 mr-2" />
							Add connection
						</Button>
					)}
				</div>
				<div
					className={cn("flex items-center gap-2 pt-1", !hasAny && "hidden")}
				>
					<Select value={providerFilter} onValueChange={setProviderFilter}>
						<SelectTrigger className="w-40">
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
						<SelectTrigger className="w-40">
							<SelectValue placeholder="All statuses" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All statuses</SelectItem>
							<SelectItem value="ACTIVE">Active</SelectItem>
							<SelectItem value="TOKEN_EXPIRED">Token expired</SelectItem>
							<SelectItem value="REFRESH_FAILED">Refresh failed</SelectItem>
							<SelectItem value="CREDENTIALS_INVALID">
								Credentials invalid
							</SelectItem>
							<SelectItem value="REVOKED">Revoked</SelectItem>
							<SelectItem value="ERROR">Error</SelectItem>
						</SelectContent>
					</Select>
				</div>

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
											<p className="text-record text-muted-foreground">
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
														<Mono>
															{formatDateTime(connection.lastRefreshedAt)}
														</Mono>
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
											onClick={() => handleEditConnection(connection)}
										>
											<Pencil className="h-4 w-4" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => {
												setDeleteTargetId(connection.id);
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
					<div
						className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed p-4"
						data-testid="connections-empty"
					>
						<p className="text-record text-muted-foreground">
							{providerFilter !== "all" || statusFilter !== "all"
								? "No connections match filters."
								: "No connections configured yet."}
						</p>
						<Button onClick={() => setShowAddDialog(true)}>
							<Plus className="h-4 w-4 mr-2" />
							Add connection
						</Button>
					</div>
				)}
			</div>

			{/* Form dialogs */}
			<ConnectionFormDialog
				open={showAddDialog}
				onOpenChange={setShowAddDialog}
				mode="create"
			/>

			<ConnectionFormDialog
				open={showEditDialog}
				onOpenChange={(open) => {
					setShowEditDialog(open);
					if (!open) setSelectedConnection(null);
				}}
				mode="edit"
				connection={selectedConnection}
			/>

			<DeleteConnectionDialog
				open={showDeleteDialog}
				onOpenChange={setShowDeleteDialog}
				connectionId={deleteTargetId}
				error={deleteError}
				onDelete={handleDelete}
				onCancel={() => {
					setShowDeleteDialog(false);
					setDeleteTargetId(null);
					setDeleteError(null);
				}}
				isDeleting={deleteConnection.isPending}
			/>
		</div>
	);
}
