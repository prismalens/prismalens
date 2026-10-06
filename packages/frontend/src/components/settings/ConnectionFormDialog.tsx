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
import { Field } from "./Field";
import { getTemplateIcon } from "./integration-utils";

/** Prefix to distinguish new-template selections from existing integration IDs */
const NEW_TEMPLATE_PREFIX = "new:";

export function filterAvailableTemplates(
	templates?: AuthTemplateResponse[],
	integrations?: Integration[],
): AuthTemplateResponse[] {
	if (!templates || !integrations) return [];
	const existingTemplateIds = new Set(
		integrations.map((i: Integration) => i.templateId),
	);
	return templates.filter(
		(t: AuthTemplateResponse) =>
			t.connectionCreationMode === "form" && !existingTemplateIds.has(t.id),
	);
}

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

	// Form-based auth templates without an existing integration
	const availableTemplates = useMemo(
		() => filterAvailableTemplates(templates, integrations),
		[templates, integrations],
	);

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

	const blankKeeps =
		mode === "edit" ? "blank keeps the saved value" : undefined;
	const oauth = selectedTemplate?.connectionCreationMode === "oauth_redirect";

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{mode === "create" ? "Add connection" : "Edit connection"}
					</DialogTitle>
					<DialogDescription>
						{mode === "create"
							? "An account an integration reaches through."
							: oauth
								? "Sign in again with the provider."
								: "New credentials replace the saved ones."}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{mode === "create" && (
						<Field
							label="Integration"
							htmlFor="integrationSelect"
							error={showErrors && !selectedValue && "Choose an integration."}
						>
							<Select
								value={selectedValue ?? ""}
								onValueChange={handleSelectionChange}
							>
								<SelectTrigger id="integrationSelect" className="w-full">
									<SelectValue placeholder="Choose one" />
								</SelectTrigger>
								<SelectContent>
									{integrations && integrations.length > 0 && (
										<SelectGroup>
											<SelectLabel>Yours</SelectLabel>
											{integrations.map((integration: Integration) => (
												<SelectItem key={integration.id} value={integration.id}>
													<span className="flex items-center gap-2">
														{getTemplateIcon(integration.templateId)}
														<span>{integration.label}</span>
													</span>
												</SelectItem>
											))}
										</SelectGroup>
									)}

									{availableTemplates.length > 0 && (
										<SelectGroup>
											<SelectLabel>Add a new one</SelectLabel>
											{availableTemplates.map(
												(template: AuthTemplateResponse) => (
													<SelectItem
														key={template.id}
														value={`${NEW_TEMPLATE_PREFIX}${template.id}`}
													>
														<span className="flex items-center gap-2">
															{getTemplateIcon(template.id)}
															<span>{template.name}</span>
														</span>
													</SelectItem>
												),
											)}
										</SelectGroup>
									)}
								</SelectContent>
							</Select>
						</Field>
					)}

					{selectedTemplate && (
						<>
							{mode === "create" && (
								<Field label="Label" note="optional" htmlFor="connectionLabel">
									<Input
										id="connectionLabel"
										value={connectionLabel}
										onChange={(e) => setConnectionLabel(e.target.value)}
										placeholder="Personal account"
									/>
								</Field>
							)}

							{selectedTemplate.connectionFields &&
								selectedTemplate.connectionFields.length > 0 && (
									<DynamicCredentialForm
										fields={selectedTemplate.connectionFields}
										values={connectionFieldValues}
										onChange={setConnectionFieldValues}
										showErrors={showErrors}
									/>
								)}

							{!oauth &&
								selectedTemplate.connectionCredentialFields &&
								selectedTemplate.connectionCredentialFields.length > 0 && (
									<DynamicCredentialForm
										fields={selectedTemplate.connectionCredentialFields}
										values={credentialValues}
										onChange={setCredentialValues}
										showErrors={showErrors}
										note={blankKeeps}
									/>
								)}
						</>
					)}
					<MutationError error={error} />
				</div>

				<DialogFooter>
					<Button variant="text" onClick={() => handleOpenChange(false)}>
						Cancel
					</Button>
					<Button variant="primary" onClick={handleSave} disabled={isSaving}>
						{isSaving && (
							<Loader2 className="size-3.5 motion-safe:animate-spin" />
						)}
						{oauth
							? mode === "edit"
								? "Sign in again"
								: "Continue with the provider"
							: "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
