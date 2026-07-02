"use client";

import type {
	AuthTemplateResponse,
	Integration,
} from "@prismalens/contracts/schemas";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
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
} from "@/lib/api/hooks";
import { validateFieldValues } from "@/lib/credential-schema";
import { DynamicCredentialForm } from "./DynamicCredentialForm";
import { getTemplateIcon } from "./integration-utils";

/** Prefix to distinguish new-template selections from existing integration IDs */
const NEW_TEMPLATE_PREFIX = "new:";

/** Auth modes that can be fully set up in a single dialog (no integration-level credentials needed) */
const SIMPLE_AUTH_MODES = new Set(["api_key", "basic"]);

interface AddConnectionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	preselectedIntegrationId?: string;
}

export function AddConnectionDialog({
	open,
	onOpenChange,
	preselectedIntegrationId,
}: AddConnectionDialogProps) {
	const { data: integrations } = useIntegrations();
	const { data: templates } = useTemplates();
	const createConnection = useCreateConnection();
	const createIntegration = useCreateIntegration();
	const deleteIntegration = useDeleteIntegration();

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

	// Determine if selection is an existing integration or a new template
	const isNewTemplate = selectedValue?.startsWith(NEW_TEMPLATE_PREFIX) ?? false;
	const selectedTemplateId = isNewTemplate
		? selectedValue?.slice(NEW_TEMPLATE_PREFIX.length)
		: undefined;

	const selectedIntegration = !isNewTemplate
		? integrations?.find((i: Integration) => i.id === selectedValue)
		: undefined;

	const selectedTemplate = templates?.find(
		(t: AuthTemplateResponse) =>
			t.id ===
			(isNewTemplate ? selectedTemplateId : selectedIntegration?.templateId),
	);

	// Simple auth templates without an existing integration — one integration per template
	const availableTemplates = useMemo(() => {
		if (!templates || !integrations) return [];
		const existingTemplateIds = new Set(
			integrations.map((i: Integration) => i.templateId),
		);
		return templates.filter(
			(t: AuthTemplateResponse) =>
				SIMPLE_AUTH_MODES.has(t.authMode) && !existingTemplateIds.has(t.id),
		);
	}, [templates, integrations]);

	const isPending = createConnection.isPending || createIntegration.isPending;

	const reset = () => {
		setSelectedValue(preselectedIntegrationId ?? null);
		setConnectionLabel("");
		setCredentialValues({});
		setConnectionFieldValues({});
		setShowErrors(false);
		setError(null);
	};

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) reset();
		onOpenChange(nextOpen);
	};

	const handleSelectionChange = (val: string) => {
		setSelectedValue(val);
		setCredentialValues({});
		setConnectionFieldValues({});
		setShowErrors(false);
		setError(null);

		// Auto-fill connection label
		if (val.startsWith(NEW_TEMPLATE_PREFIX)) {
			const templateId = val.slice(NEW_TEMPLATE_PREFIX.length);
			const template = templates?.find(
				(t: AuthTemplateResponse) => t.id === templateId,
			);
			setConnectionLabel(template?.name ?? "");
		} else {
			const integration = integrations?.find((i: Integration) => i.id === val);
			setConnectionLabel(integration?.label ?? "");
		}
	};

	const handleSave = async () => {
		if (!selectedTemplate) return;
		setError(null);

		// OAuth redirect flow
		if (selectedTemplate.connectionCreationMode === "oauth_redirect") {
			if (!selectedIntegration) return;
			try {
				const res = await fetch(
					`/api/integrations/oauth/${selectedIntegration.id}/authorize`,
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
				setError(
					err instanceof Error ? err : new Error("Failed to start OAuth flow"),
				);
			}
			return;
		}

		// Validate credential fields
		const credFields = selectedTemplate.connectionCredentialFields ?? [];
		if (credFields.length > 0) {
			const errors = validateFieldValues(credFields, credentialValues);
			if (Object.keys(errors).length > 0) {
				setShowErrors(true);
				return;
			}
		}

		// Validate connection fields
		const connFields = selectedTemplate.connectionFields ?? [];
		if (connFields.length > 0) {
			const connErrors = validateFieldValues(connFields, connectionFieldValues);
			if (Object.keys(connErrors).length > 0) {
				setShowErrors(true);
				return;
			}
		}

		// Validate connection label
		if (!connectionLabel.trim()) {
			setShowErrors(true);
			return;
		}

		try {
			let integrationId: string;
			let createdNewIntegration = false;

			if (isNewTemplate && selectedTemplateId) {
				// Available provider — reuse existing integration or create new
				const existingForTemplate = integrations?.find(
					(i: Integration) => i.templateId === selectedTemplateId,
				);
				if (existingForTemplate) {
					integrationId = existingForTemplate.id;
				} else {
					const integration = await createIntegration.mutateAsync({
						templateId: selectedTemplateId,
						label: selectedTemplate?.name ?? connectionLabel.trim(),
					});
					integrationId = integration.id;
					createdNewIntegration = true;
				}
			} else if (selectedIntegration) {
				integrationId = selectedIntegration.id;
			} else {
				return;
			}

			try {
				await createConnection.mutateAsync({
					integrationId,
					label: connectionLabel.trim(),
					credentials: credFields.length > 0 ? credentialValues : {},
					connectionConfig:
						Object.keys(connectionFieldValues).length > 0
							? connectionFieldValues
							: undefined,
				});
				handleOpenChange(false);
			} catch (connErr) {
				// Compensate: clean up auto-created integration if connection failed
				if (createdNewIntegration) {
					await deleteIntegration
						.mutateAsync({ id: integrationId })
						.catch(() => {});
				}
				throw connErr;
			}
		} catch (err) {
			setError(
				err instanceof Error ? err : new Error("Failed to create connection"),
			);
		}
	};

	const hasExistingIntegrations = (integrations?.length ?? 0) > 0;
	const hasAvailableTemplates = availableTemplates.length > 0;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add Connection</DialogTitle>
					<DialogDescription>
						{isNewTemplate
							? `Connect to ${selectedTemplate?.name ?? "a new provider"}`
							: "Create an authenticated connection to an existing integration"}
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 py-4">
					{/* Integration / provider picker */}
					<div className="space-y-2">
						<Label>Integration</Label>
						<Select
							value={selectedValue ?? ""}
							onValueChange={handleSelectionChange}
						>
							<SelectTrigger>
								<SelectValue placeholder="Select an integration..." />
							</SelectTrigger>
							<SelectContent>
								{hasExistingIntegrations && (
									<SelectGroup>
										<SelectLabel>Existing integrations</SelectLabel>
										{integrations?.map((integration: Integration) => {
											const template = templates?.find(
												(t: AuthTemplateResponse) =>
													t.id === integration.templateId,
											);
											return (
												<SelectItem key={integration.id} value={integration.id}>
													<div className="flex items-center gap-2">
														<span className="text-muted-foreground">
															{getTemplateIcon(integration.templateId)}
														</span>
														<span>{integration.label}</span>
														{template && (
															<Badge variant="outline" className="ml-1 text-xs">
																{template.authModeLabel}
															</Badge>
														)}
													</div>
												</SelectItem>
											);
										})}
									</SelectGroup>
								)}
								{hasAvailableTemplates && (
									<SelectGroup>
										<SelectLabel>Available providers</SelectLabel>
										{availableTemplates.map(
											(template: AuthTemplateResponse) => (
												<SelectItem
													key={`new:${template.id}`}
													value={`${NEW_TEMPLATE_PREFIX}${template.id}`}
												>
													<div className="flex items-center gap-2">
														<span className="text-muted-foreground">
															{getTemplateIcon(template.id)}
														</span>
														<span>{template.name}</span>
														<Badge variant="secondary" className="ml-1 text-xs">
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
					</div>

					{/* Connection name */}
					{selectedValue && (
						<div className="space-y-2">
							<Label htmlFor="connection-label">Connection Name</Label>
							<Input
								id="connection-label"
								value={connectionLabel}
								onChange={(e) => setConnectionLabel(e.target.value)}
								placeholder={selectedTemplate?.name ?? "Connection name"}
							/>
						</div>
					)}

					{/* OAuth redirect instructions */}
					{selectedTemplate?.connectionCreationMode === "oauth_redirect" && (
						<p className="text-sm text-muted-foreground">
							You will be redirected to authorize via OAuth.
						</p>
					)}

					{/* Connection fields (e.g., domain, organization) */}
					{selectedTemplate?.connectionFields &&
						selectedTemplate.connectionFields.length > 0 && (
							<DynamicCredentialForm
								fields={selectedTemplate.connectionFields}
								values={connectionFieldValues}
								onChange={setConnectionFieldValues}
								showErrors={showErrors}
							/>
						)}

					{/* Connection credential fields */}
					{selectedTemplate?.connectionCredentialFields &&
						selectedTemplate.connectionCredentialFields.length > 0 &&
						selectedTemplate.connectionCreationMode !== "oauth_redirect" && (
							<DynamicCredentialForm
								fields={selectedTemplate.connectionCredentialFields}
								values={credentialValues}
								onChange={setCredentialValues}
								showErrors={showErrors}
							/>
						)}
				</div>
				<MutationError error={error} className="mb-2" />
				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={!selectedValue || isPending}>
						{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						{selectedTemplate?.connectionCreationMode === "oauth_redirect"
							? "Connect with OAuth"
							: isNewTemplate
								? "Connect"
								: "Create Connection"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
