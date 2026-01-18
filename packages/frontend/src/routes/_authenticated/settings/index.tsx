"use client";

import { LLM_PROVIDERS, type LLMProviderId } from "@prismalens/config/browser";
import { SERVICE_TIER_METADATA } from "@prismalens/contracts/schemas";
import { createFileRoute } from "@tanstack/react-router";
import {
	AlertCircle,
	AlertTriangle,
	Bot,
	CheckCircle,
	Clock,
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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	useCreateIntegrationConnection,
	useDeleteIntegrationConnection,
	useFactoryReset,
	useIntegrationConnections,
	useIntegrationDefinitions,
	useInvestigationLimits,
	useInvestigationPolicies,
	useLlmConfigs,
	useResetData,
	useSetActiveLlmProvider,
	useTestIntegrationConnection,
	useTestLlmConnection,
	useUpdateIntegrationConnection,
	useUpdateInvestigationLimits,
	useUpdateInvestigationPolicy,
	useUpdateLlmConfig,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/settings/")({
	component: SettingsPage,
});

// Transform LLM_PROVIDERS from config into UI-friendly format
const AI_PROVIDERS = Object.values(LLM_PROVIDERS).map((provider) => ({
	id: provider.id as LLMProviderId,
	name: provider.name,
	models: [...provider.suggestedModels],
	helpUrl: provider.helpUrl,
	noApiKey: provider.envVar === null,
	baseUrlRequired:
		"baseUrlRequired" in provider ? provider.baseUrlRequired : false,
	defaultBaseUrl:
		"defaultBaseUrl" in provider ? provider.defaultBaseUrl : undefined,
}));

function SettingsPage() {
	return (
		<div className="px-4 py-6 sm:px-0">
			<h1 className="text-3xl font-bold text-foreground mb-8">Settings</h1>

			<Tabs defaultValue="ai" className="space-y-6">
				<TabsList>
					<TabsTrigger value="ai">AI Provider</TabsTrigger>
					<TabsTrigger value="investigation">Investigation</TabsTrigger>
					<TabsTrigger value="integrations">Integrations</TabsTrigger>
					<TabsTrigger value="danger">Danger Zone</TabsTrigger>
				</TabsList>

				<TabsContent value="ai">
					<AIProviderSettings />
				</TabsContent>

				<TabsContent value="investigation">
					<InvestigationSettings />
				</TabsContent>

				<TabsContent value="integrations">
					<IntegrationsSettings />
				</TabsContent>

				<TabsContent value="danger">
					<DangerZoneSettings />
				</TabsContent>
			</Tabs>
		</div>
	)
}

function AIProviderSettings() {
	const { data: configs, isLoading: configsLoading } = useLlmConfigs();
	const updateConfig = useUpdateLlmConfig();
	const setActive = useSetActiveLlmProvider();
	const testConnection = useTestLlmConnection();

	// Form state
	const [selectedProvider, setSelectedProvider] = useState<LLMProviderId>(
		AI_PROVIDERS[0]?.id || "anthropic",
	)
	const [apiKey, setApiKey] = useState("");
	const [selectedModel, setSelectedModel] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [testStatus, setTestStatus] = useState<
		"idle" | "testing" | "success" | "error"
	>("idle");
	const [testError, setTestError] = useState<string | null>(null);

	// Get provider metadata
	const provider = AI_PROVIDERS.find((p) => p.id === selectedProvider);

	// Get active provider from configs
	const activeProvider = configs?.activeProvider;
	const providersList = configs?.providers || [];

	// Convert providers array to a map for easier lookup
	const providerConfigsMap = providersList.reduce(
		(acc, p) => {
			acc[p.provider] = p;
			return acc;
		},
		{} as Record<string, (typeof providersList)[number]>,
	)

	// Load saved config when provider changes or configs load
	useEffect(() => {
		if (!provider) return;

		const savedConfig = providerConfigsMap[selectedProvider];
		if (savedConfig) {
			// Note: apiKey is masked, so we don't prefill it (user must re-enter)
			setApiKey("");
			setSelectedModel(savedConfig.model || provider.models[0] || "");
			setBaseUrl(savedConfig.baseUrl || provider.defaultBaseUrl || "");
		} else {
			setApiKey("");
			setSelectedModel(provider.models[0] || "");
			setBaseUrl(provider.defaultBaseUrl || "");
		}
		setTestStatus("idle");
		setTestError(null);
	}, [selectedProvider, providerConfigsMap, provider]);

	const handleTestConnection = async () => {
		setTestStatus("testing");
		setTestError(null);

		try {
			const result = await testConnection.mutateAsync({
				provider: selectedProvider,
				apiKey: apiKey || undefined,
				model: selectedModel,
				baseUrl: provider?.baseUrlRequired ? baseUrl : undefined,
			})

			if (result.success) {
				setTestStatus("success");
			} else {
				setTestStatus("error");
				setTestError(result.error || "Connection test failed");
			}
		} catch (err) {
			setTestStatus("error");
			setTestError(
				err instanceof Error ? err.message : "Connection test failed",
			)
		}
	}

	const handleSaveConfig = async () => {
		try {
			await updateConfig.mutateAsync({
				provider: selectedProvider,
				apiKey: apiKey || undefined,
				model: selectedModel,
				baseUrl: provider?.baseUrlRequired ? baseUrl : undefined,
			})

			// Also set as active if not already
			if (activeProvider !== selectedProvider) {
				await setActive.mutateAsync({ provider: selectedProvider });
			}
		} catch (err) {
			console.error("Failed to save config:", err);
		}
	}

	const handleSetActive = async (providerId: LLMProviderId) => {
		try {
			await setActive.mutateAsync({ provider: providerId });
		} catch (err) {
			console.error("Failed to set active provider:", err);
		}
	}

	if (configsLoading) {
		return (
			<Card>
				<CardContent className="flex items-center justify-center py-12">
					<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
				</CardContent>
			</Card>
		)
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-3">
					<div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
						<Bot className="h-5 w-5 text-primary" />
					</div>
					<div>
						<CardTitle>AI Provider Configuration</CardTitle>
						<CardDescription>
							Configure your preferred LLM provider for AI-powered
							investigations
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-6">
				{/* Active Provider Status */}
				{activeProvider && (
					<div className="p-4 bg-muted/50 rounded-lg">
						<div className="flex items-center gap-2 text-sm">
							<CheckCircle className="h-4 w-4 text-green-500" />
							<span className="text-muted-foreground">Active provider:</span>
							<span className="font-medium">
								{AI_PROVIDERS.find((p) => p.id === activeProvider)?.name ||
									activeProvider}
							</span>
						</div>
					</div>
				)}

				{/* Provider Selection */}
				<div className="space-y-3">
					<Label>Select Provider</Label>
					<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
						{AI_PROVIDERS.map((p) => {
							const isConfigured = !!providerConfigsMap[p.id];
							const isActive = activeProvider === p.id;

							return (
								<button
									key={p.id}
									type="button"
									onClick={() => setSelectedProvider(p.id)}
									className={cn(
										"p-4 rounded-lg border-2 text-left transition-colors relative",
										selectedProvider === p.id
											? "border-primary bg-primary/5"
											: "border-muted hover:border-muted-foreground/50",
									)}
								>
									<div className="flex flex-col gap-1">
										<span className="font-medium text-sm">{p.name}</span>
										{p.noApiKey && (
											<span className="text-xs text-muted-foreground">
												No API key
											</span>
										)}
									</div>
									{isActive && (
										<div className="absolute top-2 right-2">
											<CheckCircle className="h-4 w-4 text-green-500" />
										</div>
									)}
									{isConfigured && !isActive && (
										<div className="absolute top-2 right-2">
											<div className="w-2 h-2 bg-blue-500 rounded-full" />
										</div>
									)}
								</button>
							)
						})}
					</div>
				</div>

				{/* Provider-Specific Configuration */}
				<div className="space-y-4 pt-4 border-t">
					<h3 className="font-medium">
						{provider?.name || "Provider"} Configuration
					</h3>

					{/* API Key (not for Ollama) */}
					{!provider?.noApiKey && (
						<div className="space-y-2">
							<Label htmlFor="apiKey">API Key</Label>
							<Input
								id="apiKey"
								type="password"
								value={apiKey}
								onChange={(e) => {
									setApiKey(e.target.value)
									setTestStatus("idle")
								}}
								placeholder="Enter your API key"
							/>
							{provider?.helpUrl && (
								<p className="text-xs text-muted-foreground flex items-center gap-1">
									Get a key:{" "}
									<a
										href={provider.helpUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-primary hover:underline inline-flex items-center gap-1"
									>
										{new URL(provider.helpUrl).hostname}
										<ExternalLink className="h-3 w-3" />
									</a>
								</p>
							)}
						</div>
					)}

					{/* Base URL (for Ollama) */}
					{provider?.baseUrlRequired && (
						<div className="space-y-2">
							<Label htmlFor="baseUrl">Base URL</Label>
							<Input
								id="baseUrl"
								type="text"
								value={baseUrl}
								onChange={(e) => {
									setBaseUrl(e.target.value)
									setTestStatus("idle")
								}}
								placeholder={provider.defaultBaseUrl || "http://localhost:11434"}
							/>
							<p className="text-xs text-muted-foreground">
								URL of your Ollama server. Default: http://localhost:11434
							</p>
						</div>
					)}

					{/* Model Selection */}
					<div className="space-y-2">
						<Label>Model</Label>
						<Select value={selectedModel} onValueChange={setSelectedModel}>
							<SelectTrigger>
								<SelectValue placeholder="Select a model" />
							</SelectTrigger>
							<SelectContent>
								{provider?.models.map((model) => (
									<SelectItem key={model} value={model}>
										{model}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							You can also type a custom model name if not listed
						</p>
					</div>

					{/* Test Connection Result */}
					{testStatus !== "idle" && (
						<div
							className={cn(
								"p-3 rounded-lg flex items-center gap-2",
								testStatus === "success"
									? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
									: testStatus === "error"
										? "bg-destructive/10 text-destructive"
										: "bg-muted",
							)}
						>
							{testStatus === "testing" && (
								<>
									<Loader2 className="h-4 w-4 animate-spin" />
									<span className="text-sm">Testing connection...</span>
								</>
							)}
							{testStatus === "success" && (
								<>
									<CheckCircle className="h-4 w-4" />
									<span className="text-sm">Connection successful!</span>
								</>
							)}
							{testStatus === "error" && (
								<>
									<AlertCircle className="h-4 w-4" />
									<span className="text-sm">
										{testError || "Connection failed"}
									</span>
								</>
							)}
						</div>
					)}

					{/* Actions */}
					<div className="flex gap-3 pt-2">
						<Button
							variant="outline"
							onClick={handleTestConnection}
							disabled={
								testConnection.isPending ||
								(!provider?.noApiKey && !apiKey) ||
								!selectedModel
							}
						>
							{testConnection.isPending ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<Sparkles className="mr-2 h-4 w-4" />
							)}
							Test Connection
						</Button>
						<Button
							onClick={handleSaveConfig}
							disabled={
								updateConfig.isPending ||
								(!provider?.noApiKey && !apiKey) ||
								!selectedModel
							}
						>
							{updateConfig.isPending ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : null}
							Save & Set Active
						</Button>
					</div>
				</div>

				{/* Configured Providers List */}
				{providersList.length > 0 && (
					<div className="space-y-3 pt-4 border-t">
						<Label>Configured Providers</Label>
						<div className="space-y-2">
							{providersList.map((config) => {
								const providerInfo = AI_PROVIDERS.find(
									(p) => p.id === config.provider,
								)
								const isActive = activeProvider === config.provider;

								return (
									<div
										key={config.provider}
										className={cn(
											"flex items-center justify-between p-3 rounded-lg border",
											isActive &&
												"border-green-500/50 bg-green-50/50 dark:bg-green-900/20",
										)}
									>
										<div className="flex items-center gap-3">
											{isActive && (
												<CheckCircle className="h-4 w-4 text-green-500" />
											)}
											<div>
												<span className="font-medium">
													{providerInfo?.name || config.provider}
												</span>
												<span className="text-sm text-muted-foreground ml-2">
													({config.model || "No model set"})
												</span>
											</div>
										</div>
										{!isActive && (
											<Button
												variant="ghost"
												size="sm"
												onClick={() =>
													handleSetActive(config.provider as LLMProviderId)
												}
											>
												Set Active
											</Button>
										)}
									</div>
								)
							})}
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	)
}

function InvestigationSettings() {
	const { data: policies, isLoading: policiesLoading } =
		useInvestigationPolicies();
	const { data: limits, isLoading: limitsLoading } = useInvestigationLimits();
	const updatePolicy = useUpdateInvestigationPolicy();
	const updateLimits = useUpdateInvestigationLimits();

	const [editingLimits, setEditingLimits] = useState(false);
	const [localLimits, setLocalLimits] = useState({
		maxConcurrent: 5,
		timeoutMinutes: 30,
		maxToolCalls: 100,
	})

	// Sync local limits with server data
	useEffect(() => {
		if (limits) {
			setLocalLimits({
				maxConcurrent: limits.maxConcurrent,
				timeoutMinutes: limits.timeoutMinutes,
				maxToolCalls: limits.maxToolCalls,
			})
		}
	}, [limits]);

	const autoInvestigateOptions = [
		{ value: "always", label: "Always" },
		{ value: "critical_high", label: "Critical & High only" },
		{ value: "manual", label: "Manual trigger" },
		{ value: "never", label: "Never" },
	]

	const handlePolicyChange = async (
		tier: string,
		field: string,
		value: boolean | string,
	) => {
		const currentPolicy = policies?.policies.find((p) => p.tier === tier);
		if (!currentPolicy) return;

		const { tier: _tier, ...policyWithoutTier } = currentPolicy;
		await updatePolicy.mutateAsync({
			tier: tier as "tier_1" | "tier_2" | "tier_3" | "tier_4",
			...policyWithoutTier,
			[field]: value,
		})
	}

	const handleSaveLimits = async () => {
		await updateLimits.mutateAsync(localLimits);
		setEditingLimits(false);
	}

	if (policiesLoading || limitsLoading) {
		return (
			<Card>
				<CardContent className="flex items-center justify-center py-12">
					<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
				</CardContent>
			</Card>
		)
	}

	return (
		<div className="space-y-6">
			{/* Tier Policies */}
			<Card>
				<CardHeader>
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
							<Settings2 className="h-5 w-5 text-primary" />
						</div>
						<div>
							<CardTitle>Investigation Policies</CardTitle>
							<CardDescription>
								Configure how investigations are triggered for each service tier
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					{(policies?.policies ?? []).map((policy) => {
						const tierMeta = SERVICE_TIER_METADATA[policy.tier];

						return (
							<div
								key={policy.tier}
								className="p-4 border rounded-lg space-y-4"
							>
								<div className="flex items-center justify-between">
									<div>
										<h3 className="font-medium">{tierMeta.name}</h3>
										<p className="text-sm text-muted-foreground">
											{tierMeta.description}
										</p>
									</div>
									<div className="flex items-center gap-2">
										<Zap className="h-4 w-4 text-muted-foreground" />
										<Select
											value={policy.autoInvestigate}
											onValueChange={(value) =>
												handlePolicyChange(
													policy.tier,
													"autoInvestigate",
													value,
												)
											}
										>
											<SelectTrigger className="w-[180px]">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{autoInvestigateOptions.map((opt) => (
													<SelectItem key={opt.value} value={opt.value}>
														{opt.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								</div>

								<div className="grid grid-cols-3 gap-4 pt-2 border-t">
									<label className="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											checked={policy.requiresApproval}
											onChange={(e) =>
												handlePolicyChange(
													policy.tier,
													"requiresApproval",
													e.target.checked,
												)
											}
											className="rounded border-gray-300"
										/>
										Requires approval
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											checked={policy.pageOnCall}
											onChange={(e) =>
												handlePolicyChange(
													policy.tier,
													"pageOnCall",
													e.target.checked,
												)
											}
											className="rounded border-gray-300"
										/>
										Page on-call
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											checked={policy.postToSlack}
											onChange={(e) =>
												handlePolicyChange(
													policy.tier,
													"postToSlack",
													e.target.checked,
												)
											}
											className="rounded border-gray-300"
										/>
										Post to Slack
									</label>
								</div>
							</div>
						)
					})}
				</CardContent>
			</Card>

			{/* Investigation Limits */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center">
								<Clock className="h-5 w-5 text-orange-600 dark:text-orange-400" />
							</div>
							<div>
								<CardTitle>Investigation Limits</CardTitle>
								<CardDescription>
									Resource constraints for AI investigations
								</CardDescription>
							</div>
						</div>
						{!editingLimits && (
							<Button variant="outline" onClick={() => setEditingLimits(true)}>
								Edit Limits
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					{editingLimits ? (
						<div className="space-y-4">
							<div className="grid grid-cols-3 gap-4">
								<div className="space-y-2">
									<Label htmlFor="maxConcurrent">Max Concurrent</Label>
									<Input
										id="maxConcurrent"
										type="number"
										min={1}
										max={100}
										value={localLimits.maxConcurrent}
										onChange={(e) =>
											setLocalLimits({
												...localLimits,
												maxConcurrent: parseInt(e.target.value) || 1,
											})
										}
									/>
									<p className="text-xs text-muted-foreground">
										Max investigations running at once
									</p>
								</div>
								<div className="space-y-2">
									<Label htmlFor="timeoutMinutes">Timeout (minutes)</Label>
									<Input
										id="timeoutMinutes"
										type="number"
										min={1}
										max={120}
										value={localLimits.timeoutMinutes}
										onChange={(e) =>
											setLocalLimits({
												...localLimits,
												timeoutMinutes: parseInt(e.target.value) || 1,
											})
										}
									/>
									<p className="text-xs text-muted-foreground">
										Max time per investigation
									</p>
								</div>
								<div className="space-y-2">
									<Label htmlFor="maxToolCalls">Max Tool Calls</Label>
									<Input
										id="maxToolCalls"
										type="number"
										min={1}
										max={500}
										value={localLimits.maxToolCalls}
										onChange={(e) =>
											setLocalLimits({
												...localLimits,
												maxToolCalls: parseInt(e.target.value) || 1,
											})
										}
									/>
									<p className="text-xs text-muted-foreground">
										Max AI tool calls per investigation
									</p>
								</div>
							</div>
							<div className="flex gap-2 pt-2">
								<Button
									onClick={handleSaveLimits}
									disabled={updateLimits.isPending}
								>
									{updateLimits.isPending && (
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									)}
									Save Limits
								</Button>
								<Button
									variant="outline"
									onClick={() => {
										setEditingLimits(false)
										if (limits) {
											setLocalLimits({
												maxConcurrent: limits.maxConcurrent,
												timeoutMinutes: limits.timeoutMinutes,
												maxToolCalls: limits.maxToolCalls,
											})
										}
									}}
								>
									Cancel
								</Button>
							</div>
						</div>
					) : (
						<div className="grid grid-cols-3 gap-4">
							<div className="p-4 bg-muted/50 rounded-lg text-center">
								<div className="text-2xl font-bold">
									{limits?.maxConcurrent || 5}
								</div>
								<div className="text-sm text-muted-foreground">
									Max Concurrent
								</div>
							</div>
							<div className="p-4 bg-muted/50 rounded-lg text-center">
								<div className="text-2xl font-bold">
									{limits?.timeoutMinutes || 30}m
								</div>
								<div className="text-sm text-muted-foreground">Timeout</div>
							</div>
							<div className="p-4 bg-muted/50 rounded-lg text-center">
								<div className="text-2xl font-bold">
									{limits?.maxToolCalls || 100}
								</div>
								<div className="text-sm text-muted-foreground">
									Max Tool Calls
								</div>
							</div>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	)
}

// Integration icon helper
function getIntegrationIcon(integrationId: string) {
	switch (integrationId) {
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
			)
		case "error":
			return (
				<Badge variant="destructive">
					<AlertCircle className="h-3 w-3 mr-1" />
					Error
				</Badge>
			)
		case "pending":
			return (
				<Badge variant="secondary">
					<Loader2 className="h-3 w-3 mr-1 animate-spin" />
					Pending
				</Badge>
			)
		default:
			return (
				<Badge variant="outline">
					{status}
				</Badge>
			)
	}
}

function IntegrationsSettings() {
	const { data: definitions, isLoading: defsLoading } = useIntegrationDefinitions();
	const { data: connections, isLoading: connsLoading, refetch: refetchConnections } = useIntegrationConnections();
	const createConnection = useCreateIntegrationConnection();
	const updateConnection = useUpdateIntegrationConnection();
	const deleteConnection = useDeleteIntegrationConnection();
	const testConnection = useTestIntegrationConnection();

	const [showAddDialog, setShowAddDialog] = useState(false);
	const [showConfigDialog, setShowConfigDialog] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [selectedDefinition, setSelectedDefinition] = useState<string | null>(null);
	const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
	const [connectionName, setConnectionName] = useState("");
	const [configFields, setConfigFields] = useState<Record<string, string>>({});
	const [testingConnectionId, setTestingConnectionId] = useState<string | null>(null);
	const [testResults, setTestResults] = useState<Record<string, { success: boolean; error?: string }>>({});
	const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
	const [oauthMessage, setOauthMessage] = useState<{ type: "success" | "error"; message: string } | null>(null);

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
			})
			// Refetch connections to show the new one
			refetchConnections();
			// Clear message after 5 seconds
			setTimeout(() => setOauthMessage(null), 5000);
		} else if (status === "error") {
			setOauthMessage({
				type: "error",
				message: errorDescription || error || `Failed to connect to ${oauth}`,
			})
			// Clear message after 10 seconds
			setTimeout(() => setOauthMessage(null), 10000);
		}
	}, [refetchConnections]);

	// Get the base URL for webhooks
	const webhookBaseUrl = typeof window !== "undefined"
		? `${window.location.origin}/api/webhooks`
		: "/api/webhooks";

	const handleCopyUrl = async (url: string, id: string) => {
		await navigator.clipboard.writeText(url);
		setCopiedUrl(id);
		setTimeout(() => setCopiedUrl(null), 2000);
	}

	const handleAddIntegration = (definitionId: string) => {
		const definition = definitions?.find((d) => d.id === definitionId);
		if (!definition) return;

		// For OAuth integrations, redirect to OAuth flow
		if (definition.authType === "oauth2") {
			const name = `${definition.name} Connection`;
			// Build the OAuth authorize URL with name and redirect_uri
			// The redirect_uri should be the settings page (current page without query params)
			const currentUrl = new URL(window.location.href);
			currentUrl.search = ""; // Clear any existing query params
			const redirectUri = currentUrl.toString();

			const authorizeUrl = `/api/integrations/oauth/${definition.id}/authorize?` +
				`name=${encodeURIComponent(name)}&` +
				`redirect_uri=${encodeURIComponent(redirectUri)}`;

			window.location.href = authorizeUrl;
			return
		}

		// For API key integrations, show config dialog
		setSelectedDefinition(definitionId);
		setConnectionName(`${definition.name} Connection`);
		setConfigFields({});
		setShowAddDialog(false);
		setShowConfigDialog(true);
	}

	const handleEditConnection = (connectionId: string) => {
		const connection = connections?.find((c) => c.id === connectionId);
		if (!connection) return;

		setSelectedConnection(connectionId);
		setSelectedDefinition(connection.definitionId);
		setConnectionName(connection.name);
		// Note: We don't prefill sensitive config fields
		setConfigFields({});
		setShowConfigDialog(true);
	}

	const handleSaveConnection = async () => {
		if (!selectedDefinition) return;

		try {
			if (selectedConnection) {
				// Update existing
				await updateConnection.mutateAsync({
					id: selectedConnection,
					name: connectionName,
					credentials: configFields.token || configFields.password
						? { apiKey: configFields.token || configFields.password }
						: undefined,
					config: configFields,
				})
			} else {
				// Create new - requires authMethod and credentials
				await createConnection.mutateAsync({
					definitionId: selectedDefinition,
					name: connectionName,
					authMethod: "api_key",
					credentials: {
						apiKey: configFields.token || configFields.password || configFields.webhookUrl,
					},
					config: configFields,
				})
			}
			setShowConfigDialog(false);
			resetDialogState();
		} catch (err) {
			console.error("Failed to save connection:", err);
		}
	}

	const handleDeleteConnection = async () => {
		if (!selectedConnection) return;

		try {
			await deleteConnection.mutateAsync({ id: selectedConnection });
			setShowDeleteDialog(false);
			resetDialogState();
		} catch (err) {
			console.error("Failed to delete connection:", err);
		}
	}

	const handleTestConnection = async (connectionId: string) => {
		setTestingConnectionId(connectionId);
		try {
			const result = await testConnection.mutateAsync({ id: connectionId });
			setTestResults((prev) => ({
				...prev,
				[connectionId]: { success: result.success },
			}))
		} catch (err) {
			setTestResults((prev) => ({
				...prev,
				[connectionId]: { success: false, error: err instanceof Error ? err.message : "Test failed" },
			}))
		} finally {
			setTestingConnectionId(null);
		}
	}

	const resetDialogState = () => {
		setSelectedDefinition(null);
		setSelectedConnection(null);
		setConnectionName("");
		setConfigFields({});
	}

	const getDefinitionById = (id: string) => definitions?.find((d) => d.id === id);
	const selectedDef = selectedDefinition ? getDefinitionById(selectedDefinition) : null;

	if (defsLoading || connsLoading) {
		return (
			<Card>
				<CardContent className="flex items-center justify-center py-12">
					<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
				</CardContent>
			</Card>
		)
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
							: "bg-destructive/10 text-destructive"
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
							onClick={() => handleCopyUrl(`${webhookBaseUrl}/prometheus`, "prometheus")}
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
							onClick={() => handleCopyUrl(`${webhookBaseUrl}/generic`, "generic")}
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
												{getIntegrationIcon(connection.definitionId)}
											</div>
											<div>
												<div className="flex items-center gap-2">
													<span className="font-medium">{connection.name}</span>
													<ConnectionStatusBadge status={connection.status} />
												</div>
												<p className="text-sm text-muted-foreground">
													{definition?.name} • {definition?.authType === "oauth2" ? "OAuth" : "API Key"}
													{connection.lastHealthCheck && (
														<> • Last check: {new Date(connection.lastHealthCheck).toLocaleString()}</>
													)}
												</p>
												{testResult && (
													<p className={cn(
														"text-xs mt-1",
														testResult.success ? "text-green-600" : "text-destructive"
													)}>
														{testResult.success ? "Connection test passed" : testResult.error}
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
													setSelectedConnection(connection.id)
													setShowDeleteDialog(true)
												}}
											>
												<Trash2 className="h-4 w-4 text-destructive" />
											</Button>
										</div>
									</div>
								)
							})}
						</div>
					) : (
						<div className="text-center py-8">
							<Link2 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
							<p className="text-muted-foreground">No integrations connected yet</p>
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
									{getIntegrationIcon(def.id)}
								</div>
								<div className="flex-1">
									<p className="font-medium">{def.name}</p>
									<p className="text-sm text-muted-foreground">{def.description}</p>
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
			<Dialog open={showConfigDialog} onOpenChange={(open) => {
				setShowConfigDialog(open);
				if (!open) resetDialogState();
			}}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{selectedConnection ? "Edit" : "Configure"} {selectedDef?.name}
						</DialogTitle>
						<DialogDescription>
							{selectedDef?.description}
						</DialogDescription>
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

						{/* Dynamic config fields based on integration */}
						{selectedDefinition === "prometheus" && (
							<>
								<div className="space-y-2">
									<Label htmlFor="baseUrl">Prometheus URL *</Label>
									<Input
										id="baseUrl"
										value={configFields.baseUrl || ""}
										onChange={(e) => setConfigFields({ ...configFields, baseUrl: e.target.value })}
										placeholder="http://prometheus:9090"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="username">Username (optional)</Label>
									<Input
										id="username"
										value={configFields.username || ""}
										onChange={(e) => setConfigFields({ ...configFields, username: e.target.value })}
										placeholder="Basic auth username"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="password">Password / API Key (optional)</Label>
									<Input
										id="password"
										type="password"
										value={configFields.password || ""}
										onChange={(e) => setConfigFields({ ...configFields, password: e.target.value })}
										placeholder="Basic auth password or API key"
									/>
								</div>
							</>
						)}

						{selectedDefinition === "slack" && selectedDef?.authType !== "oauth2" && (
							<>
								<div className="space-y-2">
									<Label htmlFor="webhookUrl">Webhook URL *</Label>
									<Input
										id="webhookUrl"
										value={configFields.webhookUrl || ""}
										onChange={(e) => setConfigFields({ ...configFields, webhookUrl: e.target.value })}
										placeholder="https://hooks.slack.com/services/..."
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="defaultChannel">Default Channel</Label>
									<Input
										id="defaultChannel"
										value={configFields.defaultChannel || ""}
										onChange={(e) => setConfigFields({ ...configFields, defaultChannel: e.target.value })}
										placeholder="#incidents"
									/>
								</div>
							</>
						)}

						{selectedDefinition === "github" && selectedDef?.authType !== "oauth2" && (
							<>
								<div className="space-y-2">
									<Label htmlFor="token">Personal Access Token *</Label>
									<Input
										id="token"
										type="password"
										value={configFields.token || ""}
										onChange={(e) => setConfigFields({ ...configFields, token: e.target.value })}
										placeholder="ghp_..."
									/>
									<p className="text-xs text-muted-foreground">
										Requires repo scope for private repositories
									</p>
								</div>
								<div className="space-y-2">
									<Label htmlFor="organization">Organization</Label>
									<Input
										id="organization"
										value={configFields.organization || ""}
										onChange={(e) => setConfigFields({ ...configFields, organization: e.target.value })}
										placeholder="your-org"
									/>
								</div>
							</>
						)}
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => {
							setShowConfigDialog(false);
							resetDialogState()
						}}>
							Cancel
						</Button>
						<Button
							onClick={handleSaveConnection}
							disabled={createConnection.isPending || updateConnection.isPending || !connectionName}
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
							This will remove the integration connection. Any services using this
							integration will no longer have access to its data.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => {
							setShowDeleteDialog(false);
							setSelectedConnection(null);
						}}>
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
	)
}

function DangerZoneSettings() {
	const [showResetDialog, setShowResetDialog] = useState(false);
	const [showFactoryResetDialog, setShowFactoryResetDialog] = useState(false);
	const [confirmText, setConfirmText] = useState("");

	const resetData = useResetData();
	const factoryReset = useFactoryReset();

	const handleResetData = async () => {
		try {
			await resetData.mutateAsync({ confirmation: "RESET" });
			setShowResetDialog(false);
			setConfirmText("");
		} catch (err) {
			console.error("Reset failed:", err);
		}
	}

	const handleFactoryReset = async () => {
		try {
			await factoryReset.mutateAsync({ confirmation: "FACTORY RESET" });
			setShowFactoryResetDialog(false);
			setConfirmText("");
			// Redirect to setup wizard
			window.location.href = "/setup";
		} catch (err) {
			console.error("Factory reset failed:", err);
		}
	}

	return (
		<>
			<Card className="border-destructive/50">
				<CardHeader>
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 bg-destructive/10 rounded-lg flex items-center justify-center">
							<AlertTriangle className="h-5 w-5 text-destructive" />
						</div>
						<div>
							<CardTitle className="text-destructive">Danger Zone</CardTitle>
							<CardDescription>
								Destructive operations that cannot be undone
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-6">
					{/* Reset Data */}
					<div className="flex justify-between items-center p-4 border border-destructive/30 rounded-lg">
						<div>
							<h3 className="font-medium text-foreground">Reset All Data</h3>
							<p className="text-sm text-muted-foreground">
								Delete all alerts, incidents, and investigations. Services and
								integrations will be preserved.
							</p>
						</div>
						<Button
							variant="destructive"
							onClick={() => setShowResetDialog(true)}
						>
							<Trash2 className="mr-2 h-4 w-4" />
							Reset Data
						</Button>
					</div>

					{/* Factory Reset */}
					<div className="flex justify-between items-center p-4 border border-destructive/30 rounded-lg">
						<div>
							<h3 className="font-medium text-foreground">Factory Reset</h3>
							<p className="text-sm text-muted-foreground">
								Delete ALL data and return to initial setup state. This removes
								users, services, and all configurations.
							</p>
						</div>
						<Button
							variant="destructive"
							onClick={() => setShowFactoryResetDialog(true)}
						>
							<AlertTriangle className="mr-2 h-4 w-4" />
							Factory Reset
						</Button>
					</div>
				</CardContent>
			</Card>

			{/* Reset Data Dialog */}
			<AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Reset All Data?</AlertDialogTitle>
						<AlertDialogDescription className="space-y-2">
							<p>This will permanently delete:</p>
							<ul className="list-disc list-inside text-sm">
								<li>All alerts</li>
								<li>All incidents</li>
								<li>All investigations</li>
								<li>All recommendations</li>
							</ul>
							<p className="pt-2">
								Services, integrations, and settings will be preserved.
							</p>
							<div className="pt-4">
								<Label htmlFor="confirm-reset">
									Type <strong>RESET</strong> to confirm
								</Label>
								<Input
									id="confirm-reset"
									value={confirmText}
									onChange={(e) => setConfirmText(e.target.value)}
									placeholder="RESET"
									className="mt-2"
								/>
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setConfirmText("")}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={confirmText !== "RESET" || resetData.isPending}
							onClick={handleResetData}
							className="bg-destructive hover:bg-destructive/90"
						>
							{resetData.isPending && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							Reset All Data
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Factory Reset Dialog */}
			<AlertDialog
				open={showFactoryResetDialog}
				onOpenChange={setShowFactoryResetDialog}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Factory Reset?</AlertDialogTitle>
						<AlertDialogDescription className="space-y-2">
							<p>
								This will permanently delete <strong>everything</strong>:
							</p>
							<ul className="list-disc list-inside text-sm">
								<li>All users (except owner)</li>
								<li>All services</li>
								<li>All integrations</li>
								<li>All alerts, incidents, and investigations</li>
								<li>All settings and configurations</li>
							</ul>
							<p className="pt-2">
								You will be redirected to the setup wizard to start fresh.
							</p>
							<div className="pt-4">
								<Label htmlFor="confirm-factory-reset">
									Type <strong>FACTORY RESET</strong> to confirm
								</Label>
								<Input
									id="confirm-factory-reset"
									value={confirmText}
									onChange={(e) => setConfirmText(e.target.value)}
									placeholder="FACTORY RESET"
									className="mt-2"
								/>
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setConfirmText("")}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={confirmText !== "FACTORY RESET" || factoryReset.isPending}
							onClick={handleFactoryReset}
							className="bg-destructive hover:bg-destructive/90"
						>
							{factoryReset.isPending && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							Factory Reset
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
