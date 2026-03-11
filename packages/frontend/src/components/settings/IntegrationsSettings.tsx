"use client";

import { useNavigate } from "@tanstack/react-router";
import {
	AlertCircle,
	CheckCircle,
	Copy,
	ExternalLink,
	Github,
	Link2,
	Loader2,
	MessageSquare,
	Pencil,
	Plus,
	Settings2,
	Sparkles,
	Trash2,
	Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import type { AuthTemplateResponse } from "@prismalens/contracts/schemas";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
	useConnections,
	useConnectGitHubInstallation,
	useCreateConnection,
	useCreateIntegration,
	useDeleteConnection,
	useGitHubInstallations,
	useTemplates,
	useTestConnection,
	useUpdateConnection,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { validateFieldValues } from "@/lib/credential-schema";
import { DynamicCredentialForm } from "./DynamicCredentialForm";

// Template icon helper — uses template.id
function getTemplateIcon(templateId: string) {
	if (templateId.startsWith("github"))
		return <Github className="h-5 w-5" />;
	if (templateId.startsWith("slack"))
		return <MessageSquare className="h-5 w-5" />;
	if (templateId.startsWith("prometheus"))
		return <Zap className="h-5 w-5" />;
	return <Link2 className="h-5 w-5" />;
}

// Connection status badge
function ConnectionStatusBadge({ status }: { status: string }) {
	switch (status) {
		case "ACTIVE":
			return (
				<Badge variant="secondary">
					<CheckCircle className="h-3 w-3 mr-1" />
					Connected
				</Badge>
			);
		case "TOKEN_EXPIRED":
			return (
				<Badge variant="secondary">
					<AlertCircle className="h-3 w-3 mr-1" />
					Token Expired
				</Badge>
			);
		case "REFRESH_FAILED":
		case "CREDENTIALS_INVALID":
		case "REVOKED":
		case "ERROR":
			return (
				<Badge variant="destructive">
					<AlertCircle className="h-3 w-3 mr-1" />
					{status.replace(/_/g, " ")}
				</Badge>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}

export function IntegrationsSettings() {
	const { data: templates, isLoading: templatesLoading } = useTemplates();
	const {
		data: connections,
		isLoading: connsLoading,
		refetch: refetchConnections,
	} = useConnections();
	const createIntegration = useCreateIntegration();
	const createConnection = useCreateConnection();
	const updateConnection = useUpdateConnection();
	const deleteConnection = useDeleteConnection();
	const testConnection = useTestConnection();
	const navigate = useNavigate();

	const [showAddDialog, setShowAddDialog] = useState(false);
	const [showConfigDialog, setShowConfigDialog] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [selectedTemplate, setSelectedTemplate] =
		useState<AuthTemplateResponse | null>(null);
	const [selectedConnection, setSelectedConnection] = useState<string | null>(
		null,
	);
	const [connectionLabel, setConnectionLabel] = useState("");
	const [credentialValues, setCredentialValues] = useState<
		Record<string, string>
	>({});
	const [connectionFieldValues, setConnectionFieldValues] = useState<
		Record<string, string>
	>({});
	// OAuth-specific fields
	const [oauthClientId, setOauthClientId] = useState("");
	const [oauthClientSecret, setOauthClientSecret] = useState("");
	const [showCredErrors, setShowCredErrors] = useState(false);
	const [testingConnectionId, setTestingConnectionId] = useState<string | null>(
		null,
	);
	const [testResults, setTestResults] = useState<
		Record<string, { success: boolean; error?: string }>
	>({});
	const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
	const [oauthMessage, setOauthMessage] = useState<{
		type: "success" | "error";
		message: string;
	} | null>(null);

	// Handle OAuth callback query params
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
				message: (errorDescription || error || `Failed to connect to ${oauth}`).slice(0, 200),
			});
			setTimeout(() => setOauthMessage(null), 10000);
		}
	}, [refetchConnections]);

	const webhookBaseUrl =
		typeof window !== "undefined"
			? `${window.location.origin}/api/webhooks`
			: "/api/webhooks";

	const handleCopyUrl = async (url: string, id: string) => {
		try {
			await navigator.clipboard.writeText(url);
			setCopiedUrl(id);
			setTimeout(() => setCopiedUrl(null), 2000);
		} catch {
			toast({ title: "Failed to copy URL", variant: "destructive" });
		}
	};

	const handleAddIntegration = (template: AuthTemplateResponse) => {
		setSelectedTemplate(template);
		// Auto-increment label if connections with same templateId exist
		const existingCount = connections?.filter(
			(c) => c.templateId === template.id,
		).length ?? 0;
		const label = existingCount > 0
			? `${template.name} Connection ${existingCount + 1}`
			: `${template.name} Connection`;
		setConnectionLabel(label);
		setCredentialValues({});
		setConnectionFieldValues({});
		setOauthClientId("");
		setOauthClientSecret("");
		setShowCredErrors(false);
		setShowAddDialog(false);
		setShowConfigDialog(true);
	};

	const handleEditConnection = (connectionId: string) => {
		const connection = connections?.find((c) => c.id === connectionId);
		if (!connection) return;

		const template = templates?.find(
			(t) => t.id === connection.templateId,
		);
		setSelectedConnection(connectionId);
		setSelectedTemplate(template ?? null);
		setConnectionLabel(connection.integration?.label ?? "");
		setCredentialValues({});
		setConnectionFieldValues({});
		setShowCredErrors(false);
		setShowConfigDialog(true);
	};

	const handleSaveConnection = async () => {
		if (!selectedTemplate) return;

		if (selectedTemplate.authMode === "github_app") {
			if (selectedConnection) {
				// Edit existing GitHub App connection
				try {
					const hasNewCredentials = Object.values(credentialValues).some(
						(v) => v.trim() !== "",
					);
					await updateConnection.mutateAsync({
						id: selectedConnection,
						credentials: hasNewCredentials ? credentialValues : undefined,
						connectionConfig:
							Object.keys(connectionFieldValues).length > 0
								? connectionFieldValues
								: undefined,
					});
					setShowConfigDialog(false);
					resetDialogState();
				} catch (err) {
					toast({
						title: "Failed to update connection",
						description: err instanceof Error ? err.message : "An unexpected error occurred",
						variant: "destructive",
					});
				}
				return;
			}

			// Create new GitHub App integration
			const credFields = selectedTemplate.credentialFields ?? [];
			if (credFields.length > 0) {
				const errors = validateFieldValues(credFields, credentialValues);
				if (Object.keys(errors).length > 0) {
					setShowCredErrors(true);
					return;
				}
			}

			const connFields = selectedTemplate.connectionFields ?? [];
			if (connFields.length > 0) {
				const connErrors = validateFieldValues(connFields, connectionFieldValues);
				if (Object.keys(connErrors).length > 0) {
					setShowCredErrors(true);
					return;
				}
			}

			try {
				const appId = credentialValues.appId;
				const privateKey = credentialValues.privateKey;
				const webhookSecret = credentialValues.webhookSecret;

				const integration = await createIntegration.mutateAsync({
					templateId: selectedTemplate.id,
					label: connectionLabel,
					clientId: appId,
					clientSecret: JSON.stringify({
						privateKey,
						...(webhookSecret ? { webhookSecret } : {}),
					}),
				});

				setShowConfigDialog(false);
				resetDialogState();

				// Navigate to configure page for installation selection
				await navigate({
					to: "/settings/integrations/configure",
					search: {
						integrationId: integration.id,
						provider: "github",
						mode: "github-app",
					},
				});
			} catch (err) {
				toast({
					title: "Failed to create integration",
					description: err instanceof Error ? err.message : "An unexpected error occurred",
					variant: "destructive",
				});
			}
			return;
		}

		if (selectedTemplate.authMode === "oauth2") {
			if (selectedConnection) {
				// Edit existing OAuth connection (re-authorize)
				try {
					const connection = connections?.find((c) => c.id === selectedConnection);
					const integrationId = connection?.integrationId;
					if (!integrationId) throw new Error("Integration not found");

					setShowConfigDialog(false);
					resetDialogState();

					// Re-trigger OAuth flow with existing integration
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
					toast({
						title: "Failed to re-authorize",
						description: err instanceof Error ? err.message : "An unexpected error occurred",
						variant: "destructive",
					});
				}
				return;
			}

			// Create new OAuth integration
			if (!oauthClientId || !oauthClientSecret) {
				setShowCredErrors(true);
				return;
			}

			try {
				const integration = await createIntegration.mutateAsync({
					templateId: selectedTemplate.id,
					label: connectionLabel,
					clientId: oauthClientId,
					clientSecret: oauthClientSecret,
				});

				setShowConfigDialog(false);
				resetDialogState();

				const res = await fetch(
					`/api/integrations/oauth/${integration.id}/authorize`,
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
				toast({
					title: "Failed to create integration",
					description: err instanceof Error ? err.message : "An unexpected error occurred",
					variant: "destructive",
				});
			}
			return;
		}

		// API Key / Basic Auth: validate credential fields
		const credFields = selectedTemplate.credentialFields ?? [];
		if (!selectedConnection && credFields.length > 0) {
			const errors = validateFieldValues(credFields, credentialValues);
			if (Object.keys(errors).length > 0) {
				setShowCredErrors(true);
				return;
			}
		}

		try {
			if (selectedConnection) {
				// Update existing connection
				const hasNewCredentials = Object.values(credentialValues).some(
					(v) => v.trim() !== "",
				);
				await updateConnection.mutateAsync({
					id: selectedConnection,
					credentials: hasNewCredentials ? credentialValues : undefined,
					connectionConfig:
						Object.keys(connectionFieldValues).length > 0
							? connectionFieldValues
							: undefined,
				});
			} else {
				// Create integration + connection in one flow for non-OAuth
				const integration = await createIntegration.mutateAsync({
					templateId: selectedTemplate.id,
					label: connectionLabel,
				});

				await createConnection.mutateAsync({
					integrationId: integration.id,
					credentials: credentialValues,
					connectionConfig:
						Object.keys(connectionFieldValues).length > 0
							? connectionFieldValues
							: undefined,
				});
			}
			setShowConfigDialog(false);
			resetDialogState();
		} catch (err) {
			toast({
				title: "Failed to save connection",
				description: err instanceof Error ? err.message : "An unexpected error occurred",
				variant: "destructive",
			});
		}
	};

	const handleDeleteConnection = async () => {
		if (!selectedConnection) return;

		try {
			await deleteConnection.mutateAsync({ id: selectedConnection });
			setShowDeleteDialog(false);
			resetDialogState();
		} catch (err) {
			toast({
				title: "Failed to delete connection",
				description: err instanceof Error ? err.message : "An unexpected error occurred",
				variant: "destructive",
			});
		}
	};

	const handleTestConnection = async (connectionId: string) => {
		setTestingConnectionId(connectionId);
		try {
			const result = await testConnection.mutateAsync({ id: connectionId });
			setTestResults((prev) => ({
				...prev,
				[connectionId]: { success: result.success },
			}));
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

	const resetDialogState = () => {
		setSelectedTemplate(null);
		setSelectedConnection(null);
		setConnectionLabel("");
		setCredentialValues({});
		setConnectionFieldValues({});
		setOauthClientId("");
		setOauthClientSecret("");
		setShowCredErrors(false);
	};

	if (templatesLoading || connsLoading) {
		return (
			<Card>
				<CardContent className="flex items-center justify-center py-12">
					<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-6">
			{/* OAuth callback message */}
			{oauthMessage && (
				<div
					className={cn(
						"p-4 rounded-lg flex items-center gap-3",
						oauthMessage.type === "success"
							? "bg-muted text-foreground"
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

			{/* Webhook URLs Card */}
			<Card>
				<CardHeader>
					<div className="flex items-center gap-2">
						<Link2 className="h-5 w-5 text-muted-foreground" />
						<CardTitle>Webhook URLs</CardTitle>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
						<div className="flex items-center gap-3">
							<Zap className="h-5 w-5 text-muted-foreground" />
							<div>
								<p className="font-medium text-sm">Prometheus AlertManager</p>
								<code className="text-xs text-muted-foreground break-all">
									{webhookBaseUrl}/prometheus
								</code>
							</div>
						</div>
						<Button
							variant="ghost"
							size="sm"
							onClick={() =>
								handleCopyUrl(`${webhookBaseUrl}/prometheus`, "prometheus")
							}
						>
							{copiedUrl === "prometheus" ? (
								<CheckCircle className="h-4 w-4 text-muted-foreground" />
							) : (
								<Copy className="h-4 w-4" />
							)}
						</Button>
					</div>

					<div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
						<div className="flex items-center gap-3">
							<Link2 className="h-5 w-5 text-muted-foreground" />
							<div>
								<p className="font-medium text-sm">Generic Webhook</p>
								<code className="text-xs text-muted-foreground break-all">
									{webhookBaseUrl}/generic
								</code>
							</div>
						</div>
						<Button
							variant="ghost"
							size="sm"
							onClick={() =>
								handleCopyUrl(`${webhookBaseUrl}/generic`, "generic")
							}
						>
							{copiedUrl === "generic" ? (
								<CheckCircle className="h-4 w-4 text-muted-foreground" />
							) : (
								<Copy className="h-4 w-4" />
							)}
						</Button>
					</div>
				</CardContent>
			</Card>

			{/* Connected Integrations */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Settings2 className="h-5 w-5 text-muted-foreground" />
							<CardTitle>Connected Integrations</CardTitle>
						</div>
						<Button onClick={() => setShowAddDialog(true)}>
							<Plus className="h-4 w-4 mr-2" />
							Add Integration
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{connections && connections.length > 0 ? (
						<div className="space-y-3">
							{connections.map((connection) => {
								const testResult = testResults[connection.id];

								return (
									<div
										key={connection.id}
										className="flex items-center justify-between p-4 border rounded-lg"
									>
										<div className="flex items-center gap-3">
											{getTemplateIcon(
												connection.templateId ?? "",
											)}
											<div>
												<div className="flex items-center gap-2">
													<span className="font-medium">
														{connection.integration?.label ??
															connection.templateName ??
															"Connection"}
													</span>
													<ConnectionStatusBadge
														status={connection.status}
													/>
												</div>
												<p className="text-sm text-muted-foreground">
													{connection.templateName} •{" "}
													{connection.integration
														? connection.integration.enabled
															? "Enabled"
															: "Disabled"
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
												onClick={() =>
													handleTestConnection(connection.id)
												}
												disabled={
													testingConnectionId === connection.id
												}
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
												onClick={() =>
													handleEditConnection(connection.id)
												}
											>
												<Pencil className="h-4 w-4" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => {
													setSelectedConnection(connection.id);
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
						<div className="text-center py-8">
							<Link2 className="h-5 w-5 mx-auto text-muted-foreground mb-3" />
							<p className="text-muted-foreground">
								No integrations connected yet
							</p>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Add Integration Dialog — pick a template */}
			<Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add Integration</DialogTitle>
						<DialogDescription>
							Connect an external service to PrismaLens
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-3 py-4">
						{templates?.map((template) => (
							<button
								key={template.id}
								type="button"
								onClick={() => handleAddIntegration(template)}
								className="w-full flex items-center gap-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors text-left"
							>
								<span className="text-muted-foreground">{getTemplateIcon(template.id)}</span>
								<div className="flex-1">
									<p className="font-medium">{template.name}</p>
									<p className="text-sm text-muted-foreground">
										{template.category}
									</p>
								</div>
								<Badge variant="outline">
									{template.authMode === "oauth2"
										? "OAuth"
										: template.authMode === "github_app"
											? "GitHub App"
											: template.authMode === "basic"
												? "Basic Auth"
												: "API Key"}
								</Badge>
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

			{/* Configure Integration Dialog */}
			<Dialog
				open={showConfigDialog}
				onOpenChange={(open) => {
					setShowConfigDialog(open);
					if (!open) resetDialogState();
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{selectedConnection ? "Edit" : "Configure"}{" "}
							{selectedTemplate?.name}
						</DialogTitle>
						<DialogDescription>
							{selectedTemplate?.authMode === "oauth2"
								? "Enter your OAuth app credentials to connect"
								: selectedTemplate?.authMode === "github_app"
									? "Enter your GitHub App credentials. You'll select an installation next."
									: "Enter your credentials to connect"}
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
							<Label htmlFor="connectionLabel">Label</Label>
							<Input
								id="connectionLabel"
								value={connectionLabel}
								onChange={(e) => setConnectionLabel(e.target.value)}
								placeholder="e.g., Production GitHub"
							/>
						</div>

						{/* OAuth-specific fields */}
						{selectedTemplate?.authMode === "oauth2" && !selectedConnection && (
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
										aria-invalid={
											showCredErrors && !oauthClientId
												? true
												: undefined
										}
									/>
									{showCredErrors && !oauthClientId && (
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
										onChange={(e) =>
											setOauthClientSecret(e.target.value)
										}
										placeholder="OAuth App Client Secret"
										aria-invalid={
											showCredErrors && !oauthClientSecret
												? true
												: undefined
										}
									/>
									{showCredErrors && !oauthClientSecret && (
										<p className="text-sm text-destructive">
											Client Secret is required
										</p>
									)}
								</div>
								<div className="space-y-2">
									<Label>Callback URL</Label>
									<div className="flex items-center gap-2">
										<code className="flex-1 text-xs bg-muted p-2 rounded break-all">
											{window.location.origin}/api/integrations/oauth/callback
										</code>
										<Button
											variant="ghost"
											size="sm"
											onClick={() =>
												handleCopyUrl(
													`${window.location.origin}/api/integrations/oauth/callback`,
													"oauth-callback",
												)
											}
										>
											{copiedUrl === "oauth-callback" ? (
												<CheckCircle className="h-4 w-4 text-muted-foreground" />
											) : (
												<Copy className="h-4 w-4" />
											)}
										</Button>
									</div>
									<p className="text-xs text-muted-foreground">
										Set this as the Redirect URL in your {selectedTemplate?.name} app settings
									</p>
								</div>
							</>
						)}

						{/* Connection fields (e.g., domain, site) */}
						{selectedTemplate?.connectionFields &&
							selectedTemplate.connectionFields.length > 0 && (
								<DynamicCredentialForm
									fields={selectedTemplate.connectionFields}
									values={connectionFieldValues}
									onChange={setConnectionFieldValues}
									showErrors={showCredErrors}
								/>
							)}

						{/* Credential fields (for api_key / basic / github_app auth) */}
						{selectedTemplate?.authMode !== "oauth2" &&
							selectedTemplate?.credentialFields &&
							selectedTemplate.credentialFields.length > 0 && (
								<DynamicCredentialForm
									fields={selectedTemplate.credentialFields}
									values={credentialValues}
									onChange={setCredentialValues}
									showErrors={showCredErrors}
								/>
							)}
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setShowConfigDialog(false);
								resetDialogState();
							}}
						>
							Cancel
						</Button>
						<Button
							onClick={handleSaveConnection}
							disabled={
								createIntegration.isPending ||
								createConnection.isPending ||
								updateConnection.isPending ||
								!connectionLabel
							}
						>
							{(createIntegration.isPending ||
								createConnection.isPending ||
								updateConnection.isPending) && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							{selectedTemplate?.authMode === "oauth2" && !selectedConnection
								? "Connect with OAuth"
								: selectedTemplate?.authMode === "github_app" && !selectedConnection
									? "Save & Select Installation"
									: selectedConnection
										? "Update Connection"
										: "Create Connection"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<AlertDialog
				open={showDeleteDialog}
				onOpenChange={setShowDeleteDialog}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Connection?</AlertDialogTitle>
						<AlertDialogDescription>
							This will remove the integration connection. Any services using
							this integration will no longer have access to its data.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							onClick={() => {
								setShowDeleteDialog(false);
								setSelectedConnection(null);
							}}
						>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteConnection}
							className="bg-destructive hover:bg-destructive/90"
							disabled={deleteConnection.isPending}
						>
							{deleteConnection.isPending && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
