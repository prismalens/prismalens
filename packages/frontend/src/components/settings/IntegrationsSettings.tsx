"use client";

import {
	AlertCircle,
	CheckCircle,
	Copy,
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
	useCreateIntegrationConnection,
	useDeleteIntegrationConnection,
	useIntegrationConnections,
	useIntegrationDefinitions,
	useTestIntegrationConnection,
	useUpdateIntegrationConnection,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { parseCredentialSchema, validateCredentials } from "@/lib/credential-schema";
import { DynamicCredentialForm } from "./DynamicCredentialForm";

// Integration icon helper — uses definition.name (not UUID id)
function getIntegrationIcon(name: string) {
	switch (name) {
		case "github":
			return <Github className="h-5 w-5" />;
		case "slack":
			return <MessageSquare className="h-5 w-5" />;
		case "prometheus":
			return <Zap className="h-5 w-5" />;
		default:
			return <Link2 className="h-5 w-5" />;
	}
}

// Connection status badge
function ConnectionStatusBadge({ status }: { status: string }) {
	switch (status) {
		case "connected":
			return (
				<Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
					<CheckCircle className="h-3 w-3 mr-1" />
					Connected
				</Badge>
			);
		case "error":
			return (
				<Badge variant="destructive">
					<AlertCircle className="h-3 w-3 mr-1" />
					Error
				</Badge>
			);
		case "pending":
			return (
				<Badge variant="secondary">
					<Loader2 className="h-3 w-3 mr-1 animate-spin" />
					Pending
				</Badge>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}

export function IntegrationsSettings() {
	const { data: definitions, isLoading: defsLoading } =
		useIntegrationDefinitions();
	const {
		data: connections,
		isLoading: connsLoading,
		refetch: refetchConnections,
	} = useIntegrationConnections();
	const createConnection = useCreateIntegrationConnection();
	const updateConnection = useUpdateIntegrationConnection();
	const deleteConnection = useDeleteIntegrationConnection();
	const testConnection = useTestIntegrationConnection();

	const [showAddDialog, setShowAddDialog] = useState(false);
	const [showConfigDialog, setShowConfigDialog] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [selectedDefinition, setSelectedDefinition] = useState<string | null>(
		null,
	);
	const [selectedConnection, setSelectedConnection] = useState<string | null>(
		null,
	);
	const [connectionName, setConnectionName] = useState("");
	const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
	const [configFields, setConfigFields] = useState<Record<string, string>>({});
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

		// Clear the query params from URL
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
				message: errorDescription || error || `Failed to connect to ${oauth}`,
			});
			setTimeout(() => setOauthMessage(null), 10000);
		}
	}, [refetchConnections]);

	// Get the base URL for webhooks
	const webhookBaseUrl =
		typeof window !== "undefined"
			? `${window.location.origin}/api/webhooks`
			: "/api/webhooks";

	const handleCopyUrl = async (url: string, id: string) => {
		await navigator.clipboard.writeText(url);
		setCopiedUrl(id);
		setTimeout(() => setCopiedUrl(null), 2000);
	};

	const getDefinitionById = (id: string) =>
		definitions?.find((d) => d.id === id);

	const handleAddIntegration = (definitionId: string) => {
		const definition = definitions?.find((d) => d.id === definitionId);
		if (!definition) return;

		// For OAuth integrations, redirect to OAuth flow
		if (definition.authType === "oauth2") {
			const name = `${definition.displayName} Connection`;
			const currentUrl = new URL(window.location.href);
			currentUrl.search = "";
			const redirectUri = currentUrl.toString();

			const authorizeUrl =
				`/api/integrations/oauth/${definition.id}/authorize?` +
				`name=${encodeURIComponent(name)}&` +
				`redirect_uri=${encodeURIComponent(redirectUri)}`;

			window.location.href = authorizeUrl;
			return;
		}

		// For API key integrations, show config dialog
		setSelectedDefinition(definitionId);
		setConnectionName(`${definition.displayName} Connection`);
		setCredentialValues({});
		setConfigFields({});
		setShowCredErrors(false);
		setShowAddDialog(false);
		setShowConfigDialog(true);
	};

	const handleEditConnection = (connectionId: string) => {
		const connection = connections?.find((c) => c.id === connectionId);
		if (!connection) return;

		setSelectedConnection(connectionId);
		setSelectedDefinition(connection.definitionId);
		setConnectionName(connection.name);
		setCredentialValues({});
		setConfigFields({});
		setShowCredErrors(false);
		setShowConfigDialog(true);
	};

	const handleSaveConnection = async () => {
		if (!selectedDefinition) return;

		const definition = getDefinitionById(selectedDefinition);
		const credSchema = parseCredentialSchema(
			definition?.credentialSchema as string | null | undefined,
		);

		// Validate credentials if creating new (editing doesn't require re-entering credentials)
		if (!selectedConnection && definition?.authType !== "oauth2") {
			if (!credSchema) {
				// No credential schema defined — cannot create connection without knowing required fields
				return;
			}
			const errors = validateCredentials(credSchema, credentialValues);
			if (Object.keys(errors).length > 0) {
				setShowCredErrors(true);
				return;
			}
		}

		try {
			if (selectedConnection) {
				// Update existing
				const hasNewCredentials = Object.values(credentialValues).some(
					(v) => v.trim() !== "",
				);
				await updateConnection.mutateAsync({
					id: selectedConnection,
					name: connectionName,
					credentials: hasNewCredentials ? credentialValues : undefined,
					config: Object.keys(configFields).length > 0 ? configFields : undefined,
				});
			} else {
				// Create new
				await createConnection.mutateAsync({
					definitionId: selectedDefinition,
					name: connectionName,
					authMethod: "api_key",
					credentials: credentialValues,
					config: Object.keys(configFields).length > 0 ? configFields : undefined,
				});
			}
			setShowConfigDialog(false);
			resetDialogState();
		} catch (err) {
			console.error("Failed to save connection:", err);
		}
	};

	const handleDeleteConnection = async () => {
		if (!selectedConnection) return;

		try {
			await deleteConnection.mutateAsync({ id: selectedConnection });
			setShowDeleteDialog(false);
			resetDialogState();
		} catch (err) {
			console.error("Failed to delete connection:", err);
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
		setSelectedDefinition(null);
		setSelectedConnection(null);
		setConnectionName("");
		setCredentialValues({});
		setConfigFields({});
		setShowCredErrors(false);
	};

	const selectedDef = selectedDefinition
		? getDefinitionById(selectedDefinition)
		: null;
	const selectedCredSchema = parseCredentialSchema(
		selectedDef?.credentialSchema as string | null | undefined,
	);

	if (defsLoading || connsLoading) {
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
							? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
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
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
							<Link2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
						</div>
						<div>
							<CardTitle>Webhook URLs</CardTitle>
							<CardDescription>
								Configure your alerting tools to send webhooks to PrismaLens
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					{/* Prometheus Webhook */}
					<div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
						<div className="flex items-center gap-3">
							<Zap className="h-5 w-5 text-orange-500" />
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
								<CheckCircle className="h-4 w-4 text-green-500" />
							) : (
								<Copy className="h-4 w-4" />
							)}
						</Button>
					</div>

					{/* Generic Webhook */}
					<div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
						<div className="flex items-center gap-3">
							<Link2 className="h-5 w-5 text-gray-500" />
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
								<CheckCircle className="h-4 w-4 text-green-500" />
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
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
								<Settings2 className="h-5 w-5 text-primary" />
							</div>
							<div>
								<CardTitle>Connected Integrations</CardTitle>
								<CardDescription>
									External services connected for context and notifications
								</CardDescription>
							</div>
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
								const definition = getDefinitionById(connection.definitionId);
								const testResult = testResults[connection.id];

								return (
									<div
										key={connection.id}
										className="flex items-center justify-between p-4 border rounded-lg"
									>
										<div className="flex items-center gap-4">
											<div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
												{getIntegrationIcon(definition?.name ?? "")}
											</div>
											<div>
												<div className="flex items-center gap-2">
													<span className="font-medium">{connection.name}</span>
													<ConnectionStatusBadge status={connection.status} />
												</div>
												<p className="text-sm text-muted-foreground">
													{definition?.displayName} •{" "}
													{definition?.authType === "oauth2"
														? "OAuth"
														: "API Key"}
													{connection.lastHealthCheck && (
														<>
															{" "}
															• Last check:{" "}
															{new Date(
																connection.lastHealthCheck,
															).toLocaleString()}
														</>
													)}
												</p>
												{testResult && (
													<p
														className={cn(
															"text-xs mt-1",
															testResult.success
																? "text-green-600"
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
												onClick={() => handleEditConnection(connection.id)}
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
							<Link2 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
							<p className="text-muted-foreground">
								No integrations connected yet
							</p>
							<p className="text-sm text-muted-foreground mt-1">
								Add GitHub, Prometheus, or Slack to enhance investigations
							</p>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Add Integration Dialog */}
			<Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add Integration</DialogTitle>
						<DialogDescription>
							Connect an external service to PrismaLens
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-3 py-4">
						{definitions?.map((def) => (
							<button
								key={def.id}
								type="button"
								onClick={() => handleAddIntegration(def.id)}
								className="w-full flex items-center gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors text-left"
							>
								<div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
									{getIntegrationIcon(def.name)}
								</div>
								<div className="flex-1">
									<p className="font-medium">{def.displayName}</p>
									<p className="text-sm text-muted-foreground">
										{def.description}
									</p>
								</div>
								<Badge variant="outline">
									{def.authType === "oauth2" ? "OAuth" : "API Key"}
								</Badge>
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
							{selectedDef?.displayName}
						</DialogTitle>
						<DialogDescription>{selectedDef?.description}</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<Label htmlFor="connectionName">Connection Name</Label>
							<Input
								id="connectionName"
								value={connectionName}
								onChange={(e) => setConnectionName(e.target.value)}
								placeholder="e.g., Production Prometheus"
							/>
						</div>

						{/* Dynamic credential fields from credentialSchema */}
						{selectedCredSchema &&
							selectedDef?.authType !== "oauth2" && (
								<DynamicCredentialForm
									schema={selectedCredSchema}
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
								createConnection.isPending ||
								updateConnection.isPending ||
								!connectionName
							}
						>
							{(createConnection.isPending || updateConnection.isPending) && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							{selectedConnection ? "Update" : "Create"} Connection
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Integration?</AlertDialogTitle>
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
