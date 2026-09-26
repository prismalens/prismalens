// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type {
	AuthTemplateResponse,
	ConnectionWithIntegration,
	Integration,
} from "@prismalens/contracts/schemas";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MutationError } from "@/components/shared/MutationError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	useCreateConnection,
	useCreateIntegration,
	useDeleteIntegration,
	useIntegrations,
	useTemplates,
	useUpdateConnection,
} from "@/lib/api/hooks";
import { validateFieldValues } from "@/lib/credential-schema";
import { DynamicCredentialForm } from "./DynamicCredentialForm";
import { getTemplateIcon } from "./integration-utils";

/** Prefix to distinguish new-template selections from existing integration IDs */
const NEW_TEMPLATE_PREFIX = "new:";

/** Auth modes that can be fully set up in a single dialog (no integration-level credentials needed) */
const SIMPLE_AUTH_MODES = new Set(["api_key", "basic"]);

export interface ConnectionFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mode: "create" | "edit";
	connection?: ConnectionWithIntegration | null;
	preselectedIntegrationId?: string;
	onSuccess?: () => void;
}

export function ConnectionFormDialog({
	open,
	onOpenChange,
	mode,
	connection,
	preselectedIntegrationId,
	onSuccess,
}: ConnectionFormDialogProps) {
	const { data: integrations } = useIntegrations();
	const { data: templates } = useTemplates();
	const createConnection = useCreateConnection();
	const createIntegration = useCreateIntegration();
	const deleteIntegration = useDeleteIntegration();
	const updateConnection = useUpdateConnection();

	const [selectedValue, setSelectedValue] = useState<string | null>(
		preselectedIntegrationId ?? null,
	);
	const [connectionLabel, setConnectionLabel] = useState("");
	const [credentialValues, setCredentialValues] = useState<
		Record<string, string>
	>({});
	const [connectionFieldValues, setConnectionFieldValues] = useState<
		Record<string, string>
	>({});
	const [showErrors, setShowErrors] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	// Sync state on open change or mode/connection change
	useEffect(() => {
		if (open) {
			if (mode === "edit" && connection) {
				setSelectedValue(connection.integrationId);
				setConnectionLabel(connection.label ?? "");
				setCredentialValues({});
				setConnectionFieldValues({});
				setShowErrors(false);
				setError(null);
			} else {
				setSelectedValue(preselectedIntegrationId ?? null);
				setConnectionLabel("");
				setCredentialValues({});
				setConnectionFieldValues({});
				setShowErrors(false);
				setError(null);
			}
		}
	}, [open, mode, connection, preselectedIntegrationId]);

	// Determine if selection is an existing integration or a new template (for create mode)
	const isNewTemplate = selectedValue?.startsWith(NEW_TEMPLATE_PREFIX) ?? false;
	const selectedTemplateId = isNewTemplate
		? selectedValue?.slice(NEW_TEMPLATE_PREFIX.length)
		: undefined;

	const selectedIntegration =
		mode === "edit"
			? (connection?.integration ??
				integrations?.find(
					(i: Integration) => i.id === connection?.integrationId,
				))
			: !isNewTemplate
				? integrations?.find((i: Integration) => i.id === selectedValue)
				: undefined;

	const selectedTemplate = templates?.find(
		(t: AuthTemplateResponse) =>
			t.id ===
			(mode === "edit"
				? (connection?.templateId ?? selectedIntegration?.templateId)
				: isNewTemplate
					? selectedTemplateId
					: selectedIntegration?.templateId),
	);

	// Simple auth templates without an existing integration
	const availableTemplates = useMemo(() => {
		if (!templates || !integrations) return [];
		const existingTemplateIds = new Set(
			integrations.map((i: Integration) => i.templateId),
		);
		return templates.filter(
			(t: AuthTemplateResponse) =>
				SIMPLE_AUTH_MODES.has(t.connectionCreationMode) &&
				!existingTemplateIds.has(t.id),
		);
	}, [templates, integrations]);

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			setShowErrors(false);
			setError(null);
		}
		onOpenChange(nextOpen);
	};

	const handleSelectionChange = (value: string) => {
		setSelectedValue(value);
		setCredentialValues({});
		setConnectionFieldValues({});
		setShowErrors(false);
		setError(null);
	};

	const handleSave = async () => {
		setError(null);

		if (mode === "create") {
			if (!selectedValue) {
				setShowErrors(true);
				return;
			}

			// Validate connection fields
			if (selectedTemplate?.connectionFields) {
				const fieldErrors = validateFieldValues(
					selectedTemplate.connectionFields,
					connectionFieldValues,
				);
				if (Object.keys(fieldErrors).length > 0) {
					setShowErrors(true);
					return;
				}
			}

			// Validate credential fields for non-OAuth
			if (
				selectedTemplate &&
				selectedTemplate.connectionCreationMode !== "oauth_redirect" &&
				selectedTemplate.connectionCredentialFields
			) {
				const credErrors = validateFieldValues(
					selectedTemplate.connectionCredentialFields,
					credentialValues,
				);
				if (Object.keys(credErrors).length > 0) {
					setShowErrors(true);
					return;
				}
			}

			try {
				let integrationId: string;

				if (isNewTemplate && selectedTemplate) {
					const newIntegration = await createIntegration.mutateAsync({
						templateId: selectedTemplate.id,
						label: selectedTemplate.name,
					});
					integrationId = newIntegration.id;
				} else if (selectedIntegration) {
					integrationId = selectedIntegration.id;
				} else {
					throw new Error("No integration selected");
				}

				if (selectedTemplate?.connectionCreationMode === "oauth_redirect") {
					handleOpenChange(false);
					const res = await fetch(
						`/api/integrations/oauth/${integrationId}/authorize`,
						{
							method: "POST",
							credentials: "include",
							headers: { "Content-Type": "application/json" },
						},
					);
					if (!res.ok) {
						throw new Error(`OAuth authorize failed: ${res.status}`);
					}
					const { redirectUrl } = await res.json();
					window.location.href = redirectUrl;
					return;
				}

				try {
					await createConnection.mutateAsync({
						integrationId,
						label:
							connectionLabel.trim() || selectedTemplate?.name || "Connection",
						credentials: credentialValues,
						connectionConfig: connectionFieldValues,
					});
					handleOpenChange(false);
					onSuccess?.();
				} catch (connErr) {
					if (isNewTemplate) {
						try {
							await deleteIntegration.mutateAsync({ id: integrationId });
						} catch {
							// Best-effort cleanup
						}
					}
					throw connErr;
				}
			} catch (err) {
				setError(
					err instanceof Error ? err : new Error("Failed to create connection"),
				);
			}
		} else if (mode === "edit" && connection) {
			// For OAuth redirect, re-trigger the OAuth flow
			if (selectedTemplate?.connectionCreationMode === "oauth_redirect") {
				try {
					const integrationId = connection.integrationId;
					if (!integrationId) throw new Error("Integration not found");

					handleOpenChange(false);
					const res = await fetch(
						`/api/integrations/oauth/${integrationId}/authorize`,
						{
							method: "POST",
							credentials: "include",
							headers: { "Content-Type": "application/json" },
						},
					);
					if (!res.ok) {
						throw new Error(`OAuth authorize failed: ${res.status}`);
					}
					const { redirectUrl } = await res.json();
					window.location.href = redirectUrl;
				} catch (err) {
					setError(
						err instanceof Error
							? err
							: new Error("Failed to re-authorize connection"),
					);
				}
				return;
			}

			try {
				const hasNewCredentials = Object.values(credentialValues).some(
					(v) => v.trim() !== "",
				);
				await updateConnection.mutateAsync({
					id: connection.id,
					credentials: hasNewCredentials ? credentialValues : undefined,
					connectionConfig:
						Object.keys(connectionFieldValues).length > 0
							? connectionFieldValues
							: undefined,
				});
				handleOpenChange(false);
				onSuccess?.();
			} catch (err) {
				setError(
					err instanceof Error ? err : new Error("Failed to update connection"),
				);
			}
		}
	};

	const isSaving =
		mode === "create"
			? createConnection.isPending || createIntegration.isPending
			: updateConnection.isPending;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{mode === "create" ? "Add connection" : "Edit connection"}
					</DialogTitle>
					<DialogDescription>
						{mode === "create"
							? "Connect an account to an existing integration"
							: selectedTemplate?.connectionCreationMode === "oauth_redirect"
								? "Re-authorize your OAuth connection"
								: "Update connection credentials"}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{mode === "create" && (
						<div className="space-y-2">
							<Label htmlFor="integrationSelect">Provider / Integration</Label>
							<Select
								value={selectedValue ?? ""}
								onValueChange={handleSelectionChange}
							>
								<SelectTrigger id="integrationSelect">
									<SelectValue placeholder="Select a provider or integration" />
								</SelectTrigger>
								<SelectContent>
									{integrations && integrations.length > 0 && (
										<SelectGroup>
											<SelectLabel>Existing integrations</SelectLabel>
											{integrations.map((integration: Integration) => (
												<SelectItem key={integration.id} value={integration.id}>
													<div className="flex items-center gap-2">
														{getTemplateIcon(integration.templateId)}
														<span>{integration.label}</span>
													</div>
												</SelectItem>
											))}
										</SelectGroup>
									)}

									{availableTemplates.length > 0 && (
										<SelectGroup>
											<SelectLabel>Add new integration</SelectLabel>
											{availableTemplates.map(
												(template: AuthTemplateResponse) => (
													<SelectItem
														key={template.id}
														value={`${NEW_TEMPLATE_PREFIX}${template.id}`}
													>
														<div className="flex items-center gap-2">
															{getTemplateIcon(template.id)}
															<span>{template.name}</span>
															<Badge
																variant="outline"
																className="text-[10px] ml-1"
															>
																{template.authModeLabel}
															</Badge>
														</div>
													</SelectItem>
												),
											)}
										</SelectGroup>
									)}
								</SelectContent>
							</Select>
							{showErrors && !selectedValue && (
								<p className="text-record text-destructive">
									Please select a provider or integration
								</p>
							)}
						</div>
					)}

					{selectedTemplate && (
						<>
							{mode === "create" && (
								<div className="space-y-2">
									<Label htmlFor="connectionLabel">Connection label</Label>
									<Input
										id="connectionLabel"
										value={connectionLabel}
										onChange={(e) => setConnectionLabel(e.target.value)}
										placeholder="e.g., Personal Account (optional)"
									/>
									<p className="text-xs text-muted-foreground">
										A friendly name to distinguish this connection
									</p>
								</div>
							)}

							{/* Connection fields */}
							{selectedTemplate.connectionFields &&
								selectedTemplate.connectionFields.length > 0 && (
									<DynamicCredentialForm
										fields={selectedTemplate.connectionFields}
										values={connectionFieldValues}
										onChange={setConnectionFieldValues}
										showErrors={showErrors}
									/>
								)}

							{/* Connection credential fields (for non-OAuth) */}
							{selectedTemplate.connectionCreationMode !== "oauth_redirect" &&
								selectedTemplate.connectionCredentialFields &&
								selectedTemplate.connectionCredentialFields.length > 0 && (
									<>
										{mode === "edit" && (
											<div className="space-y-1">
												<Label className="text-record text-muted-foreground">
													Leave fields blank to keep existing values
												</Label>
											</div>
										)}
										<DynamicCredentialForm
											fields={selectedTemplate.connectionCredentialFields}
											values={credentialValues}
											onChange={setCredentialValues}
											showErrors={showErrors}
										/>
									</>
								)}
						</>
					)}
				</div>

				<MutationError error={error} />

				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={isSaving}>
						{isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						{mode === "edit" &&
						selectedTemplate?.connectionCreationMode === "oauth_redirect"
							? "Re-authorize"
							: mode === "create" &&
									selectedTemplate?.connectionCreationMode === "oauth_redirect"
								? "Connect with OAuth"
								: "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
