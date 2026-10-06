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
	useCreateIntegration,
	useTemplates,
	useUpdateIntegration,
} from "@/lib/api/hooks";
import { validateFieldValues } from "@/lib/credential-schema";
import { DynamicCredentialForm } from "./DynamicCredentialForm";
import { Field } from "./Field";
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
						: new Error("The integration was not created."),
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
						: new Error("The integration was not saved."),
				);
			}
		}
	};

	const blankKeeps =
		mode === "edit" ? "blank keeps the saved value" : undefined;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent data-testid="integration-form-dialog">
				<DialogHeader>
					<DialogTitle>
						{mode === "create"
							? step === "pick-template"
								? "Add an integration"
								: `Add ${templateWord(selectedTemplate)}`
							: `Edit ${integration?.label ?? "integration"}`}
					</DialogTitle>
					{mode === "create" && step === "pick-template" && (
						<DialogDescription>
							A git host lets a service name its code by URL.
						</DialogDescription>
					)}
				</DialogHeader>

				{mode === "create" && step === "pick-template" && (
					<div className="-mx-2">
						{templates
							?.filter(
								(t) => t.authMode !== "api_key" && t.authMode !== "basic",
							)
							.map((template) => (
								<button
									key={template.id}
									type="button"
									onClick={() => handlePickTemplate(template)}
									className="flex min-h-11 w-full items-center gap-3 rounded-control px-2 text-left transition-colors duration-(--dur-instant) hover:bg-surface-3"
									data-testid={`template-${template.id}`}
								>
									<span className="text-text-2">
										{getTemplateIcon(template.id)}
									</span>
									<span className="min-w-0 flex-1">
										<span className="block text-body text-text-1">
											{templateWord(template)}
										</span>
										<span className="block truncate text-meta text-text-3">
											{CATEGORY_WORD[template.category] ?? template.category}
										</span>
									</span>
								</button>
							))}
					</div>
				)}

				{step === "configure" && selectedTemplate && (
					<div className="space-y-4">
						<Field
							label="Label"
							htmlFor="integration-label"
							error={showErrors && !label.trim() && "Give it a label."}
						>
							<Input
								id="integration-label"
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								placeholder="Production GitHub"
								aria-invalid={showErrors && !label.trim() ? true : undefined}
							/>
						</Field>

						{selectedTemplate.integrationCredentialFields &&
							selectedTemplate.integrationCredentialFields.length > 0 && (
								<DynamicCredentialForm
									fields={selectedTemplate.integrationCredentialFields}
									values={credentialValues}
									onChange={setCredentialValues}
									showErrors={showErrors}
									note={blankKeeps}
								/>
							)}

						{selectedTemplate.connectionCreationMode === "oauth_redirect" && (
							<>
								<p className="text-body text-text-2">
									The OAuth app's credentials from {selectedTemplate.name}.{" "}
									{selectedTemplate.docsUrl && (
										<a
											href={selectedTemplate.docsUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center gap-1 text-accent hover:underline"
										>
											How to make one <ExternalLink className="size-3" />
										</a>
									)}
								</p>
								<Field
									label="Client ID"
									note={blankKeeps}
									htmlFor="oauth-client-id"
									error={
										mode === "create" &&
										showErrors &&
										!oauthClientId &&
										"The client ID is needed."
									}
								>
									<Input
										id="oauth-client-id"
										value={oauthClientId}
										onChange={(e) => setOauthClientId(e.target.value)}
										aria-invalid={
											mode === "create" && showErrors && !oauthClientId
												? true
												: undefined
										}
									/>
								</Field>
								<Field
									label="Client secret"
									note={blankKeeps}
									htmlFor="oauth-client-secret"
									error={
										mode === "create" &&
										showErrors &&
										!oauthClientSecret &&
										"The client secret is needed."
									}
								>
									<Input
										id="oauth-client-secret"
										type="password"
										value={oauthClientSecret}
										onChange={(e) => setOauthClientSecret(e.target.value)}
										aria-invalid={
											mode === "create" && showErrors && !oauthClientSecret
												? true
												: undefined
										}
									/>
								</Field>
							</>
						)}

						<MutationError error={error} />
					</div>
				)}

				<DialogFooter className="items-center">
					{mode === "create" && step === "configure" && (
						<Button
							variant="text"
							className="mr-auto"
							onClick={() => setStep("pick-template")}
						>
							<ArrowLeft />
							Another provider
						</Button>
					)}
					<Button variant="text" onClick={() => handleOpenChange(false)}>
						Cancel
					</Button>
					{step === "configure" && (
						<Button variant="primary" onClick={handleSave} disabled={isSaving}>
							{isSaving && (
								<Loader2 className="size-3.5 motion-safe:animate-spin" />
							)}
							Save
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** A provider by one name: "GitHub (App)" reads "GitHub App". */
function templateWord(t: AuthTemplateResponse | null): string {
	return t?.name.replace(/ \((\w+)\)$/, " $1") ?? "integration";
}

const CATEGORY_WORD: Record<string, string> = {
	vcs: "Git host",
	notification: "Notifications",
	monitoring: "Monitoring",
	observability: "Monitoring",
};
