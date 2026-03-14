"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type {
	AuthTemplateResponse,
	Integration,
} from "@prismalens/contracts/schemas";
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
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	useCreateConnection,
	useIntegrations,
	useTemplates,
} from "@/lib/api/hooks";
import { validateFieldValues } from "@/lib/credential-schema";
import { DynamicCredentialForm } from "./DynamicCredentialForm";
import { getTemplateIcon } from "./integration-utils";

interface AddConnectionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Pre-select a specific integration (e.g., from Integrations tab "Add Connection" action) */
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

	const [selectedIntegrationId, setSelectedIntegrationId] = useState<
		string | null
	>(preselectedIntegrationId ?? null);
	const [credentialValues, setCredentialValues] = useState<
		Record<string, string>
	>({});
	const [connectionFieldValues, setConnectionFieldValues] = useState<
		Record<string, string>
	>({});
	const [showErrors, setShowErrors] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	const selectedIntegration = integrations?.find(
		(i: Integration) => i.id === selectedIntegrationId,
	);
	const selectedTemplate = templates?.find(
		(t: AuthTemplateResponse) =>
			t.id === selectedIntegration?.templateId,
	);

	const reset = () => {
		setSelectedIntegrationId(preselectedIntegrationId ?? null);
		setCredentialValues({});
		setConnectionFieldValues({});
		setShowErrors(false);
		setError(null);
	};

	const handleOpenChange = (open: boolean) => {
		if (!open) reset();
		onOpenChange(open);
	};

	const handleSave = async () => {
		if (!selectedIntegration || !selectedTemplate) return;
		setError(null);

		// OAuth redirect — trigger OAuth flow (no credential/connection fields needed)
		if (selectedTemplate.connectionCreationMode === "oauth_redirect") {
			try {
				const res = await fetch(
					`/api/integrations/oauth/${selectedIntegration.id}/authorize`,
					{
						method: "POST",
						credentials: "include",
						headers: { "Content-Type": "application/json" },
					},
				);
				if (!res.ok)
					throw new Error(`OAuth authorize failed: ${res.status}`);
				const { redirectUrl } = await res.json();
				window.location.href = redirectUrl;
			} catch (err) {
				setError(
					err instanceof Error
						? err
						: new Error("Failed to start OAuth flow"),
				);
			}
			return;
		}

		// Validate connection credential fields
		const credFields = selectedTemplate.connectionCredentialFields ?? [];
		const showCreds = credFields.length > 0;
		if (showCreds && credFields.length > 0) {
			const errors = validateFieldValues(credFields, credentialValues);
			if (Object.keys(errors).length > 0) {
				setShowErrors(true);
				return;
			}
		}

		// Validate connection fields (all non-OAuth modes)
		const connFields = selectedTemplate.connectionFields ?? [];
		if (connFields.length > 0) {
			const connErrors = validateFieldValues(
				connFields,
				connectionFieldValues,
			);
			if (Object.keys(connErrors).length > 0) {
				setShowErrors(true);
				return;
			}
		}

		try {
			await createConnection.mutateAsync({
				integrationId: selectedIntegration.id,
				credentials: showCreds ? credentialValues : {},
				connectionConfig:
					Object.keys(connectionFieldValues).length > 0
						? connectionFieldValues
						: undefined,
			});
			handleOpenChange(false);
		} catch (err) {
			setError(
				err instanceof Error
					? err
					: new Error("Failed to create connection"),
			);
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add Connection</DialogTitle>
					<DialogDescription>
						Create an authenticated connection to an existing integration
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 py-4">
					{/* Integration picker */}
					<div className="space-y-2">
						<Label>Integration</Label>
						<Select
							value={selectedIntegrationId ?? ""}
							onValueChange={(val) => {
								setSelectedIntegrationId(val);
								setCredentialValues({});
								setConnectionFieldValues({});
								setShowErrors(false);
								setError(null);
							}}
						>
							<SelectTrigger>
								<SelectValue placeholder="Select an integration..." />
							</SelectTrigger>
							<SelectContent>
								{integrations?.map((integration: Integration) => {
									const template = templates?.find(
										(t: AuthTemplateResponse) =>
											t.id === integration.templateId,
									);
									return (
										<SelectItem
											key={integration.id}
											value={integration.id}
										>
											<div className="flex items-center gap-2">
												<span className="text-muted-foreground">
													{getTemplateIcon(
														integration.templateId,
													)}
												</span>
												<span>{integration.label}</span>
												{template && (
													<Badge
														variant="outline"
														className="ml-1 text-xs"
													>
														{template.authModeLabel}
													</Badge>
												)}
											</div>
										</SelectItem>
									);
								})}
							</SelectContent>
						</Select>
					</div>

					{/* Auth-type-aware instructions */}
					{selectedTemplate?.connectionCreationMode === "oauth_redirect" && (
						<p className="text-sm text-muted-foreground">
							You will be redirected to authorize via OAuth.
						</p>
					)}

					{/* Connection fields (e.g., domain, site) */}
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
					<Button
						variant="outline"
						onClick={() => handleOpenChange(false)}
					>
						Cancel
					</Button>
					<Button
						onClick={handleSave}
						disabled={
							!selectedIntegrationId || createConnection.isPending
						}
					>
						{createConnection.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						{selectedTemplate?.connectionCreationMode === "oauth_redirect"
							? "Connect with OAuth"
							: "Create Connection"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
