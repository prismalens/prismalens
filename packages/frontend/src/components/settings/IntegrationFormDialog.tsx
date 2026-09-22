// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type {
	AuthTemplateResponse,
	Integration,
} from "@prismalens/contracts/schemas";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Mono } from "@/components/shared/Mono";
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
	useCreateIntegration,
	useTemplates,
	useUpdateIntegration,
} from "@/lib/api/hooks";
import { validateFieldValues } from "@/lib/credential-schema";
import { DynamicCredentialForm } from "./DynamicCredentialForm";
import { getTemplateIcon } from "./integration-utils";

export interface IntegrationFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mode: "create" | "edit";
	integration?: Integration | null;
	onCreated?: (integrationId: string, template: AuthTemplateResponse) => void;
	onSuccess?: () => void;
}

type Step = "pick-template" | "configure";

export function IntegrationFormDialog({
	open,
	onOpenChange,
	mode,
	integration,
	onCreated,
	onSuccess,
}: IntegrationFormDialogProps) {
	const { data: templates } = useTemplates();
	const createIntegration = useCreateIntegration();
	const updateIntegration = useUpdateIntegration();

	const [step, setStep] = useState<Step>(
		mode === "edit" ? "configure" : "pick-template",
	);
	const [selectedTemplate, setSelectedTemplate] =
		useState<AuthTemplateResponse | null>(null);
	const [label, setLabel] = useState("");
	const [oauthClientId, setOauthClientId] = useState("");
	const [oauthClientSecret, setOauthClientSecret] = useState("");
	const [credentialValues, setCredentialValues] = useState<
		Record<string, string>
	>({});
	const [showErrors, setShowErrors] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	// Reset / sync state on open change or integration prop change
	useEffect(() => {
		if (open) {
			if (mode === "edit" && integration) {
				const tmpl = templates?.find((t) => t.id === integration.templateId);
				setSelectedTemplate(tmpl ?? null);
				setLabel(integration.label);
				setOauthClientId("");
				setOauthClientSecret("");
				setCredentialValues({});
				setShowErrors(false);
				setError(null);
				setStep("configure");
			} else {
				setStep("pick-template");
				setSelectedTemplate(null);
				setLabel("");
				setOauthClientId("");
				setOauthClientSecret("");
				setCredentialValues({});
				setShowErrors(false);
				setError(null);
			}
		}
	}, [open, mode, integration, templates]);

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			setShowErrors(false);
			setError(null);
		}
		onOpenChange(nextOpen);
	};

	const handlePickTemplate = (template: AuthTemplateResponse) => {
		setSelectedTemplate(template);
		setLabel(template.name);
		setCredentialValues({});
		setOauthClientId("");
		setOauthClientSecret("");
		setShowErrors(false);
		setError(null);
		setStep("configure");
	};

	const isSaving =
		mode === "create"
			? createIntegration.isPending
			: updateIntegration.isPending;

	const handleSave = async () => {
		if (!selectedTemplate) return;
		setError(null);

		const hasOAuthCreds =
			selectedTemplate.connectionCreationMode === "oauth_redirect";
		const integrationFields =
			selectedTemplate.integrationCredentialFields ?? [];

		if (!label.trim()) {
			setShowErrors(true);
			return;
		}

		if (mode === "create") {
			if (hasOAuthCreds) {
				if (!oauthClientId || !oauthClientSecret) {
					setShowErrors(true);
					return;
				}
			}

			if (integrationFields.length > 0) {
				const errors = validateFieldValues(integrationFields, credentialValues);
				if (Object.keys(errors).length > 0) {
					setShowErrors(true);
					return;
				}
			}

			try {
				let clientId: string | undefined;
				let clientSecret: string | undefined;

				if (hasOAuthCreds) {
					clientId = oauthClientId;
					clientSecret = oauthClientSecret;
				} else if (integrationFields.length > 0) {
					clientId = credentialValues.appId;
					const privateKey = credentialValues.privateKey;
					const webhookSecret = credentialValues.webhookSecret;
					if (privateKey) {
						clientSecret = JSON.stringify({
							privateKey,
							...(webhookSecret ? { webhookSecret } : {}),
						});
					}
				}

				const created = await createIntegration.mutateAsync({
					templateId: selectedTemplate.id,
					label: label.trim(),
					clientId,
					clientSecret,
				});

				handleOpenChange(false);
				onCreated?.(created.id, selectedTemplate);
			} catch (err) {
				setError(
					err instanceof Error
						? err
						: new Error("Failed to create integration"),
				);
			}
		} else if (mode === "edit" && integration) {
			try {
				const hasNewCredentials =
					oauthClientId.trim() !== "" ||
					oauthClientSecret.trim() !== "" ||
					Object.values(credentialValues).some((v) => v.trim() !== "");

				let clientId: string | undefined;
				let clientSecret: string | undefined;

				if (hasNewCredentials && selectedTemplate) {
					if (hasOAuthCreds) {
						clientId = oauthClientId || undefined;
						clientSecret = oauthClientSecret || undefined;
					} else if (integrationFields.length > 0) {
						clientId = credentialValues.appId || undefined;
						const privateKey = credentialValues.privateKey;
						const webhookSecret = credentialValues.webhookSecret;
						if (privateKey) {
							clientSecret = JSON.stringify({
								privateKey,
								...(webhookSecret ? { webhookSecret } : {}),
							});
						}
					}
				}

				await updateIntegration.mutateAsync({
					id: integration.id,
					label: label.trim(),
					clientId,
					clientSecret,
				});

				handleOpenChange(false);
				onSuccess?.();
			} catch (err) {
				setError(
					err instanceof Error
						? err
						: new Error("Failed to update integration"),
				);
			}
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{mode === "create"
							? step === "pick-template"
								? "Add integration"
								: `Add ${selectedTemplate?.name ?? "integration"}`
							: "Edit integration"}
					</DialogTitle>
					<DialogDescription>
						{mode === "create"
							? step === "pick-template"
								? "Choose a provider to connect to PrismaLens"
								: "Configure integration credentials"
							: "Update integration label and credentials"}
					</DialogDescription>
				</DialogHeader>

				{mode === "create" && step === "pick-template" && (
					<div className="space-y-2 py-2">
						{templates
							?.filter(
								(t) => t.authMode !== "api_key" && t.authMode !== "basic",
							)
							.map((template) => (
								<button
									key={template.id}
									type="button"
									onClick={() => handlePickTemplate(template)}
									className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
								>
									<div className="flex items-center gap-3">
										<div className="text-muted-foreground">
											{getTemplateIcon(template.id)}
										</div>
										<div>
											<p className="font-medium text-sm">{template.name}</p>
											<p className="text-xs text-muted-foreground">
												{template.category}
											</p>
										</div>
									</div>
									<Badge variant="outline" className="text-xs shrink-0">
										{template.authModeLabel}
									</Badge>
								</button>
							))}
					</div>
				)}

				{step === "configure" && selectedTemplate && (
					<div className="space-y-4 py-2">
						{mode === "create" && (
							<Button
								variant="ghost"
								size="sm"
								className="gap-1 text-xs -ml-2 text-muted-foreground"
								onClick={() => setStep("pick-template")}
							>
								<ArrowLeft className="h-3.5 w-3.5" />
								Choose another provider
							</Button>
						)}

						<div className="space-y-2">
							<Label
								htmlFor={
									mode === "edit" ? "editIntegrationLabel" : "integrationLabel"
								}
							>
								Label <span className="text-destructive">*</span>
							</Label>
							<Input
								id={
									mode === "edit" ? "editIntegrationLabel" : "integrationLabel"
								}
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								placeholder="e.g., Production GitHub"
								aria-invalid={showErrors && !label.trim() ? true : undefined}
							/>
							{showErrors && !label.trim() && (
								<p className="text-sm text-destructive">Label is required</p>
							)}
						</div>

						{/* Integration-level credentials */}
						{selectedTemplate.integrationCredentialFields &&
							selectedTemplate.integrationCredentialFields.length > 0 && (
								<>
									{mode === "edit" && (
										<div className="space-y-1">
											<Label className="text-sm text-muted-foreground">
												Leave fields blank to keep existing values
											</Label>
										</div>
									)}
									<DynamicCredentialForm
										fields={selectedTemplate.integrationCredentialFields}
										values={credentialValues}
										onChange={setCredentialValues}
										showErrors={showErrors}
									/>
								</>
							)}

						{/* OAuth App credentials */}
						{selectedTemplate.connectionCreationMode === "oauth_redirect" && (
							<div className="space-y-3">
								<div className="space-y-1">
									<p className="text-xs text-muted-foreground">
										Enter the OAuth App credentials from {selectedTemplate.name}
										.
									</p>
									{mode === "edit" && (
										<Label className="text-sm text-muted-foreground">
											Leave fields blank to keep existing values
										</Label>
									)}
								</div>

								{selectedTemplate.docsUrl && (
									<a
										href={selectedTemplate.docsUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
									>
										<span>View setup documentation</span>
										<ExternalLink className="h-3 w-3" />
									</a>
								)}

								<div className="space-y-2">
									<Label
										htmlFor={
											mode === "edit" ? "editOAuthClientId" : "oauthClientId"
										}
									>
										Client ID
										{mode === "create" && (
											<span className="text-destructive ml-1">*</span>
										)}
									</Label>
									<Input
										id={mode === "edit" ? "editOAuthClientId" : "oauthClientId"}
										value={oauthClientId}
										onChange={(e) => setOauthClientId(e.target.value)}
										placeholder={
											mode === "edit" ? "unchanged" : "OAuth Client ID"
										}
										aria-invalid={
											mode === "create" && showErrors && !oauthClientId
												? true
												: undefined
										}
									/>
									{mode === "create" && showErrors && !oauthClientId && (
										<p className="text-sm text-destructive">
											Client ID is required
										</p>
									)}
								</div>

								<div className="space-y-2">
									<Label
										htmlFor={
											mode === "edit"
												? "editOAuthClientSecret"
												: "oauthClientSecret"
										}
									>
										Client Secret
										{mode === "create" && (
											<span className="text-destructive ml-1">*</span>
										)}
									</Label>
									<Input
										id={
											mode === "edit"
												? "editOAuthClientSecret"
												: "oauthClientSecret"
										}
										type="password"
										value={oauthClientSecret}
										onChange={(e) => setOauthClientSecret(e.target.value)}
										placeholder={
											mode === "edit" ? "unchanged" : "OAuth Client Secret"
										}
										aria-invalid={
											mode === "create" && showErrors && !oauthClientSecret
												? true
												: undefined
										}
									/>
									{mode === "create" && showErrors && !oauthClientSecret && (
										<p className="text-sm text-destructive">
											Client Secret is required
										</p>
									)}
								</div>
							</div>
						)}

						<MutationError error={error} />
					</div>
				)}

				<DialogFooter>
					{step === "configure" ? (
						<>
							<Button variant="outline" onClick={() => handleOpenChange(false)}>
								Cancel
							</Button>
							<Button onClick={handleSave} disabled={isSaving}>
								{isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
								Save
							</Button>
						</>
					) : (
						<Button variant="outline" onClick={() => handleOpenChange(false)}>
							Cancel
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
