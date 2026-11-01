// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import {
	type AuthTemplateResponse,
	type ConnectionWithIntegration,
	CREDENTIAL_KIND_FIELDS,
	CREDENTIAL_KIND_LABELS,
	type Integration,
	SOURCE_CREDENTIAL_KINDS,
	type SourceCredentialKind,
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
			t.connectionCreationMode === "form" &&
			t.listed !== false &&
			!existingTemplateIds.has(t.id),
	);
}

export interface ConnectionFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mode: "create" | "edit";
	connection?: ConnectionWithIntegration | null;
	preselectedIntegrationId?: string;
	onSuccess?: () => void;
	/** The origin the environment's token is for, from `GET /sources/pre-run` (#848). */
	envOrigin?: string | null;
}

/** `new URL().origin`, or null for an address that is not one. */
export function originOf(url: string | null | undefined): string | null {
	if (!url?.trim()) return null;
	try {
		return new URL(url.trim()).origin;
	} catch {
		return null;
	}
}

/** What an address edit does to the environment token: scheme, host and port must all match (#848, case 5). */
export function envTokenChange(
	before: string | null | undefined,
	after: string | null | undefined,
	envOrigin: string | null | undefined,
): "stops" | "starts" | null {
	if (!envOrigin) return null;
	const was = originOf(before) === envOrigin;
	const is = originOf(after) === envOrigin;
	return was && !is ? "stops" : !was && is ? "starts" : null;
}

/** Edit starts from the saved address, so an untouched field saves nothing. */
function savedFields(
	connection: ConnectionWithIntegration,
): Record<string, string> {
	if (connection.baseUrl) return { baseUrl: connection.baseUrl };
	if (connection.host) return { host: connection.host };
	return {};
}

export function ConnectionFormDialog({
	open,
	onOpenChange,
	mode,
	connection,
	preselectedIntegrationId,
	onSuccess,
	envOrigin,
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
	/** For a source with credential kinds (#848); "" on edit keeps the saved credential. */
	const [credentialKind, setCredentialKind] = useState<
		SourceCredentialKind | ""
	>("");

	// Sync state on open change or mode/connection change
	useEffect(() => {
		if (open) {
			if (mode === "edit" && connection) {
				setSelectedValue(connection.integrationId);
				setConnectionLabel(connection.label ?? "");
				setCredentialValues({});
				setConnectionFieldValues(savedFields(connection));
				setCredentialKind("");
				setShowErrors(false);
				setError(null);
			} else {
				setSelectedValue(preselectedIntegrationId ?? null);
				setConnectionLabel("");
				setCredentialValues({});
				setConnectionFieldValues({});
				setCredentialKind("");
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

	// A field's default fills the form, so a git host token starts at github.com.
	const templateId = selectedTemplate?.id;
	const credentialKinds = selectedTemplate?.credentialKinds?.filter(
		(k): k is SourceCredentialKind =>
			(SOURCE_CREDENTIAL_KINDS as readonly string[]).includes(k),
	);
	const firstKind = credentialKinds?.[0];
	useEffect(() => {
		if (open && mode === "create" && firstKind) setCredentialKind(firstKind);
	}, [open, mode, firstKind]);
	const credentialFields = credentialKinds
		? credentialKind
			? CREDENTIAL_KIND_FIELDS[credentialKind]
			: []
		: (selectedTemplate?.connectionCredentialFields ?? []);
	const credentialsToSave = (): Record<string, string> =>
		credentialKinds
			? { kind: credentialKind || "none", ...credentialValues }
			: credentialValues;
	useEffect(() => {
		if (!open || mode !== "create" || !templateId) return;
		const fields =
			templates?.find((t) => t.id === templateId)?.connectionFields ?? [];
		const defaults = Object.fromEntries(
			fields.flatMap((f) => (f.default ? [[f.name, f.default]] : [])),
		);
		setConnectionFieldValues((prev) => ({ ...defaults, ...prev }));
	}, [open, mode, templateId, templates]);

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
		setCredentialKind("");
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
				credentialFields.length > 0
			) {
				const credErrors = validateFieldValues(
					credentialFields,
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

				try {
					await createConnection.mutateAsync({
						integrationId,
						label:
							connectionLabel.trim() || selectedTemplate?.name || "Connection",
						credentials: credentialsToSave(),
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
			try {
				const hasNewCredentials = credentialKinds
					? credentialKind !== ""
					: Object.values(credentialValues).some((v) => v.trim() !== "");
				const saved = savedFields(connection);
				const fieldsChanged = Object.entries(connectionFieldValues).some(
					([k, v]) => v.trim() !== (saved[k] ?? ""),
				);
				const label = connectionLabel.trim();
				// Any address or credential edit clears the last passing Test (#848).
				await updateConnection.mutateAsync({
					id: connection.id,
					...(label && label !== connection.label ? { label } : {}),
					credentials: hasNewCredentials ? credentialsToSave() : undefined,
					connectionConfig: fieldsChanged ? connectionFieldValues : undefined,
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
	const gitHost = selectedTemplate?.gitHost === true;
	const envChange =
		mode === "edit" && connection?.baseUrl
			? envTokenChange(
					connection.baseUrl,
					connectionFieldValues.baseUrl,
					envOrigin,
				)
			: null;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{gitHost
							? mode === "create"
								? "Add a git host token"
								: "Edit token"
							: mode === "create"
								? "Add connection"
								: "Edit connection"}
					</DialogTitle>
					<DialogDescription>
						{gitHost && mode === "create"
							? "Runs clone with it when this machine's own git login can't reach the host."
							: mode === "create"
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
							{(mode === "create" || credentialKinds) && (
								<Field
									label={mode === "create" ? "Label" : "Name"}
									note={mode === "create" ? "optional" : undefined}
									htmlFor="connectionLabel"
								>
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

							{envChange && (
								<p
									className="text-meta text-warn"
									role="status"
									data-testid="edit-env-change"
								>
									{envChange === "stops"
										? "The environment's token is for the old address, so it stops applying here."
										: "The environment has a token for this address; it applies while no credential is set here."}
								</p>
							)}

							{credentialKinds && (
								<Field label="Credential" htmlFor="credentialKind">
									<Select
										value={credentialKind}
										onValueChange={(v) => {
											setCredentialKind(v as SourceCredentialKind);
											setCredentialValues({});
										}}
									>
										<SelectTrigger
											id="credentialKind"
											className="w-full"
											data-testid="credential-kind"
										>
											<SelectValue placeholder="Keep the saved credential" />
										</SelectTrigger>
										<SelectContent>
											{credentialKinds.map((k) => (
												<SelectItem key={k} value={k}>
													{CREDENTIAL_KIND_LABELS[k]}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</Field>
							)}

							{!oauth && credentialFields.length > 0 && (
								<DynamicCredentialForm
									fields={credentialFields}
									values={credentialValues}
									onChange={setCredentialValues}
									showErrors={showErrors}
									note={credentialKinds ? undefined : blankKeeps}
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
