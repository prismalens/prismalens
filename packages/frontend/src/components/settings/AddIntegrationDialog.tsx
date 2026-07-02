"use client";

import type { AuthTemplateResponse } from "@prismalens/contracts/schemas";
import { ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
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
import { useCreateIntegration, useTemplates } from "@/lib/api/hooks";
import { validateFieldValues } from "@/lib/credential-schema";
import { DynamicCredentialForm } from "./DynamicCredentialForm";
import { getTemplateIcon } from "./integration-utils";

interface AddIntegrationDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Called after a successful integration creation with the new integration ID and template */
	onCreated?: (integrationId: string, template: AuthTemplateResponse) => void;
}

type Step = "pick-template" | "configure";

export function AddIntegrationDialog({
	open,
	onOpenChange,
	onCreated,
}: AddIntegrationDialogProps) {
	const { data: templates } = useTemplates();
	const createIntegration = useCreateIntegration();

	const [step, setStep] = useState<Step>("pick-template");
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

	const reset = () => {
		setStep("pick-template");
		setSelectedTemplate(null);
		setLabel("");
		setOauthClientId("");
		setOauthClientSecret("");
		setCredentialValues({});
		setShowErrors(false);
		setError(null);
	};

	const handleOpenChange = (open: boolean) => {
		if (!open) reset();
		onOpenChange(open);
	};

	const handlePickTemplate = (template: AuthTemplateResponse) => {
		setSelectedTemplate(template);
		setLabel(`${template.name}`);
		setCredentialValues({});
		setOauthClientId("");
		setOauthClientSecret("");
		setShowErrors(false);
		setError(null);
		setStep("configure");
	};

	const handleSave = async () => {
		if (!selectedTemplate) return;
		setError(null);

		const hasOAuthCreds =
			selectedTemplate.connectionCreationMode === "oauth_redirect";
		const integrationFields =
			selectedTemplate.integrationCredentialFields ?? [];

		// Validate OAuth inline fields
		if (hasOAuthCreds) {
			if (!oauthClientId || !oauthClientSecret) {
				setShowErrors(true);
				return;
			}
		}

		// Validate integration credential fields (e.g., GitHub App appId/privateKey)
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
				clientSecret = JSON.stringify({
					privateKey,
					...(webhookSecret ? { webhookSecret } : {}),
				});
			}

			const integration = await createIntegration.mutateAsync({
				templateId: selectedTemplate.id,
				label,
				clientId,
				clientSecret,
			});

			handleOpenChange(false);
			onCreated?.(integration.id, selectedTemplate);
		} catch (err) {
			setError(
				err instanceof Error ? err : new Error("Failed to create integration"),
			);
		}
	};

	// --- Template Picker Step ---
	if (step === "pick-template") {
		return (
			<Dialog open={open} onOpenChange={handleOpenChange}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add Integration</DialogTitle>
						<DialogDescription>
							Register an external service provider
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-3 py-4">
						{templates
							?.filter(
								(t) => t.authMode !== "api_key" && t.authMode !== "basic",
							)
							.map((template) => (
								<button
									key={template.id}
									type="button"
									onClick={() => handlePickTemplate(template)}
									className="w-full flex items-center gap-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors text-left"
								>
									<span className="text-muted-foreground">
										{getTemplateIcon(template.id)}
									</span>
									<div className="flex-1">
										<p className="font-medium">{template.name}</p>
										<p className="text-sm text-muted-foreground">
											{template.category}
										</p>
									</div>
									<Badge variant="outline">{template.authModeLabel}</Badge>
									{template.setupDocsUrl && (
										<a
											href={template.setupDocsUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="p-1 text-muted-foreground hover:text-foreground"
											title="Setup guide"
											onClick={(e) => e.stopPropagation()}
										>
											<ExternalLink className="h-3.5 w-3.5" />
										</a>
									)}
								</button>
							))}
					</div>
				</DialogContent>
			</Dialog>
		);
	}

	// --- Configure Step ---
	const needsOAuthCreds =
		selectedTemplate?.connectionCreationMode === "oauth_redirect";
	const hasIntegrationCreds =
		(selectedTemplate?.integrationCredentialFields?.length ?? 0) > 0;
	const needsNoCreds = !needsOAuthCreds && !hasIntegrationCreds;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Configure {selectedTemplate?.name}</DialogTitle>
					<DialogDescription>
						{needsOAuthCreds
							? "Enter your OAuth app credentials"
							: hasIntegrationCreds
								? `Enter your ${selectedTemplate?.authModeLabel} credentials`
								: `Set a label for this ${selectedTemplate?.name} integration`}
					</DialogDescription>
					{selectedTemplate?.setupDocsUrl && (
						<a
							href={selectedTemplate.setupDocsUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline pt-1"
						>
							<ExternalLink className="h-3.5 w-3.5" />
							View setup guide
						</a>
					)}
				</DialogHeader>
				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="integrationLabel">Label</Label>
						<Input
							id="integrationLabel"
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder="e.g., Production GitHub"
						/>
					</div>

					{/* OAuth-specific fields */}
					{needsOAuthCreds && (
						<>
							<div className="space-y-2">
								<Label htmlFor="oauthClientId">
									Client ID
									<span className="text-destructive ml-1">*</span>
								</Label>
								<Input
									id="oauthClientId"
									value={oauthClientId}
									onChange={(e) => setOauthClientId(e.target.value)}
									placeholder="OAuth App Client ID"
									aria-invalid={showErrors && !oauthClientId ? true : undefined}
								/>
								{showErrors && !oauthClientId && (
									<p className="text-sm text-destructive">
										Client ID is required
									</p>
								)}
							</div>
							<div className="space-y-2">
								<Label htmlFor="oauthClientSecret">
									Client Secret
									<span className="text-destructive ml-1">*</span>
								</Label>
								<Input
									id="oauthClientSecret"
									type="password"
									value={oauthClientSecret}
									onChange={(e) => setOauthClientSecret(e.target.value)}
									placeholder="OAuth App Client Secret"
									aria-invalid={
										showErrors && !oauthClientSecret ? true : undefined
									}
								/>
								{showErrors && !oauthClientSecret && (
									<p className="text-sm text-destructive">
										Client Secret is required
									</p>
								)}
							</div>
							<div className="space-y-2">
								<Label>Callback URL</Label>
								<code className="block text-xs bg-muted p-2 rounded break-all">
									{typeof window !== "undefined"
										? `${window.location.origin}/api/integrations/oauth/callback`
										: "/api/integrations/oauth/callback"}
								</code>
								<p className="text-xs text-muted-foreground">
									Set this as the Redirect URL in your {selectedTemplate?.name}{" "}
									app settings
								</p>
							</div>
						</>
					)}

					{/* Integration credential fields (e.g., GitHub App appId, privateKey, webhookSecret) */}
					{hasIntegrationCreds &&
						selectedTemplate?.integrationCredentialFields && (
							<DynamicCredentialForm
								fields={selectedTemplate.integrationCredentialFields}
								values={credentialValues}
								onChange={setCredentialValues}
								showErrors={showErrors}
							/>
						)}

					{/* API Key / Basic — no Integration-level creds needed, just label */}
					{needsNoCreds && (
						<p className="text-sm text-muted-foreground">
							Credentials will be configured when you add a connection.
						</p>
					)}
				</div>
				<MutationError error={error} className="mb-2" />
				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => {
							setStep("pick-template");
							setShowErrors(false);
							setError(null);
						}}
					>
						Back
					</Button>
					<Button
						onClick={handleSave}
						disabled={createIntegration.isPending || !label}
					>
						{createIntegration.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						{needsOAuthCreds || hasIntegrationCreds
							? "Save Integration"
							: "Create Integration"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
