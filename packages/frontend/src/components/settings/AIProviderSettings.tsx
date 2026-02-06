"use client";

import { LLM_PROVIDERS, type LLMProviderId } from "@prismalens/config/browser";
import type {
	AgentId,
	LlmProviderIdExtended,
} from "@prismalens/contracts/schemas";
import {
	AlertCircle,
	Bot,
	CheckCircle,
	ChevronDown,
	ChevronUp,
	ExternalLink,
	Info,
	Loader2,
	Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
	useDeleteLlmCredential,
	useLlmCredentialStatus,
	useLlmEnvStatus,
	useLlmModels,
	useLlmSettings,
	useSaveLlmCredential,
	useTestLlmConnectionWithEnv,
	useUpdateLlmSettings,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { ProviderModelSelector, type ProviderInfo } from "./ProviderModelSelector";
import { AgentOverrideItem, type AgentMeta } from "./AgentOverrideItem";

// Transform LLM_PROVIDERS from config into UI-friendly format
const PROVIDERS = Object.values(LLM_PROVIDERS).map((provider) => ({
	id: provider.id as LLMProviderId,
	name: provider.name,
	suggestedModels: [...provider.suggestedModels],
	helpUrl: provider.helpUrl,
	envVar: provider.envVar,
	noApiKey: provider.envVar === null,
	free: "free" in provider ? provider.free : false,
}));

// Agent metadata for per-agent overrides
const AGENTS: AgentMeta[] = [
	{
		id: "commander",
		name: "Commander",
		description: "Orchestrates the investigation workflow",
		defaultTemp: 0.1,
	},
	{
		id: "gatherer",
		name: "Gatherer",
		description: "Gathers context and explores the system",
		defaultTemp: 0,
	},
	{
		id: "detective",
		name: "Detective",
		description: "Analyzes root cause of incidents",
		defaultTemp: 0.2,
	},
	{
		id: "surgeon",
		name: "Surgeon",
		description: "Generates remediation recommendations",
		defaultTemp: 0.1,
	},
];

export function AIProviderSettings() {
	const { data: envStatus, isLoading: envLoading } = useLlmEnvStatus();
	const { data: settings, isLoading: settingsLoading } = useLlmSettings();
	const { data: modelsData, isLoading: modelsLoading } = useLlmModels();
	const { data: credentialStatus } = useLlmCredentialStatus();
	const updateSettings = useUpdateLlmSettings();
	const testConnection = useTestLlmConnectionWithEnv();
	const saveCredential = useSaveLlmCredential();
	const deleteCredential = useDeleteLlmCredential();

	// Local form state
	const [selectedProvider, setSelectedProvider] =
		useState<LlmProviderIdExtended>("anthropic");
	const [selectedModel, setSelectedModel] = useState("");
	const [customModel, setCustomModel] = useState("");
	const [temperature, setTemperature] = useState(0.1);
	const [maxTokens, setMaxTokens] = useState<number | undefined>(undefined);
	const [advancedOptions, setAdvancedOptions] = useState("");
	const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);
	const [agentOverridesOpen, setAgentOverridesOpen] = useState(false);

	// Per-agent state - track which agent's selector is expanded and their provider selection
	const [expandedAgent, setExpandedAgent] = useState<AgentId | null>(null);
	const [agentProviders, setAgentProviders] = useState<Partial<Record<AgentId, string>>>({});

	// Credential management state
	const [apiKeyInput, setApiKeyInput] = useState("");
	const [isUpdatingKey, setIsUpdatingKey] = useState(false);
	const [credentialError, setCredentialError] = useState<string | null>(null);

	// Test connection state
	const [testStatus, setTestStatus] = useState<
		"idle" | "testing" | "success" | "error"
	>("idle");
	const [testError, setTestError] = useState<string | null>(null);

	// Get provider metadata
	const provider = PROVIDERS.find((p) => p.id === selectedProvider);
	const providerEnvStatus = envStatus?.providers[selectedProvider];
	const providerCredStatus = credentialStatus?.providers?.[selectedProvider];

	// All models from registry
	const allModels = modelsData?.models || [];

	// Convert envStatus to format for ProviderModelSelector
	const envStatusMap: Record<string, { isReady: boolean; envVarName?: string }> =
		envStatus?.providers
			? Object.fromEntries(
					Object.entries(envStatus.providers).map(([id, status]) => [
						id,
						{ isReady: status.isReady, envVarName: status.envVarName ?? undefined },
					])
				)
			: {};

	// Convert PROVIDERS to ProviderInfo format
	const providerInfos: ProviderInfo[] = PROVIDERS.map((p) => ({
		id: p.id,
		name: p.name,
		free: p.free,
	}));

	// Sync form with settings when loaded or provider changes
	useEffect(() => {
		if (!settings || !provider) return;

		const providerConfig = settings.providers[selectedProvider];
		if (providerConfig) {
			setSelectedModel(providerConfig.model || "");
			setTemperature(providerConfig.temperature ?? 0.1);
			setMaxTokens(providerConfig.maxTokens);
			setAdvancedOptions(
				providerConfig.advancedOptions
					? JSON.stringify(providerConfig.advancedOptions, null, 2)
					: "",
			);
		} else {
			// Reset to defaults for unconfigured provider
			setSelectedModel(provider.suggestedModels[0] || "");
			setTemperature(0.1);
			setMaxTokens(undefined);
			setAdvancedOptions("");
		}
		setCustomModel("");
		setApiKeyInput("");
		setIsUpdatingKey(false);
		setCredentialError(null);
		setTestStatus("idle");
		setTestError(null);
	}, [selectedProvider, settings, provider]);

	// Initialize selected provider from settings
	useEffect(() => {
		if (settings?.activeProvider) {
			setSelectedProvider(settings.activeProvider);
		}
	}, [settings?.activeProvider]);

	const handleTestConnection = async () => {
		setTestStatus("testing");
		setTestError(null);

		try {
			const result = await testConnection.mutateAsync({
				provider: selectedProvider,
				model: customModel || selectedModel || undefined,
			});

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
			);
		}
	};

	const handleSaveSettings = async () => {
		// Parse advanced options JSON
		let parsedAdvancedOptions: Record<string, unknown> | undefined;
		if (advancedOptions.trim()) {
			try {
				parsedAdvancedOptions = JSON.parse(advancedOptions);
			} catch {
				// Invalid JSON - ignore for now
			}
		}

		const modelToSave = customModel || selectedModel;

		await updateSettings.mutateAsync({
			activeProvider: selectedProvider,
			providers: {
				[selectedProvider]: {
					model: modelToSave,
					temperature,
					maxTokens,
					advancedOptions: parsedAdvancedOptions,
				},
			},
		});
	};

	const isLoading = envLoading || settingsLoading;
	const hasApiKey = providerEnvStatus?.isReady || (providerCredStatus != null && providerCredStatus.activeSource !== "none");
	const canTest = hasApiKey && (selectedModel || customModel);
	const canSave = selectedModel || customModel;

	if (isLoading) {
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
			{/* API Key Info */}
			<Alert>
				<Info className="h-4 w-4" />
				<AlertTitle>API Key Management</AlertTitle>
				<AlertDescription>
					API keys can be saved via the UI (encrypted with AES-256-GCM) or set
					via environment variables (for Docker/K8s secrets). UI-saved keys take
					priority.
				</AlertDescription>
			</Alert>

			{/* Main Configuration Card */}
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
					{settings?.activeProvider && (
						<div className="p-4 bg-muted/50 rounded-lg">
							<div className="flex items-center gap-2 text-sm">
								<CheckCircle className="h-4 w-4 text-green-500" />
								<span className="text-muted-foreground">Active provider:</span>
								<span className="font-medium">
									{PROVIDERS.find((p) => p.id === settings.activeProvider)
										?.name || settings.activeProvider}
								</span>
								{settings.providers[settings.activeProvider]?.model && (
									<Badge variant="outline" className="ml-2">
										{settings.providers[settings.activeProvider]?.model}
									</Badge>
								)}
							</div>
						</div>
					)}

					{/* Provider & Model Selection (T3-style inline) */}
					<div className="space-y-3">
						<Label>Select Provider & Model</Label>
						{modelsLoading ? (
							<div className="h-[300px] border rounded-lg flex items-center justify-center">
								<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
							</div>
						) : (
							<ProviderModelSelector
								providers={providerInfos}
								models={allModels}
								envStatus={envStatusMap}
								selectedProvider={selectedProvider}
								selectedModel={selectedModel}
								customModel={customModel}
								onProviderChange={(p) => setSelectedProvider(p as LlmProviderIdExtended)}
								onModelChange={(model) => {
									setSelectedModel(model);
									setCustomModel("");
								}}
								onCustomModelChange={setCustomModel}
							/>
						)}
					</div>

					{/* API Key Management */}
					{!provider?.noApiKey && (
						<div className="space-y-3 pt-4 border-t">
							<Label>API Key</Label>
							{credentialError && (
								<div className="p-2 rounded bg-destructive/10 text-destructive text-sm">
									{credentialError}
								</div>
							)}
							{providerCredStatus?.activeSource === "db" && !isUpdatingKey ? (
								<div className="flex items-center gap-3">
									<Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
										<CheckCircle className="h-3 w-3 mr-1" />
										Stored (encrypted)
									</Badge>
									<Button
										variant="outline"
										size="sm"
										onClick={() => {
											setIsUpdatingKey(true);
											setApiKeyInput("");
											setCredentialError(null);
										}}
									>
										Update
									</Button>
									<Button
										variant="ghost"
										size="sm"
										className="text-destructive hover:text-destructive"
										onClick={() => {
											if (!window.confirm("Remove the stored API key for this provider?")) return;
											deleteCredential.mutate(
												{ provider: selectedProvider },
												{
													onError: (err) =>
														setCredentialError(
															err instanceof Error ? err.message : "Failed to delete credential",
														),
												},
											);
										}}
										disabled={deleteCredential.isPending}
									>
										{deleteCredential.isPending ? (
											<Loader2 className="h-3 w-3 animate-spin" />
										) : (
											"Remove"
										)}
									</Button>
								</div>
							) : providerCredStatus?.activeSource === "env" && !isUpdatingKey ? (
								<div className="flex items-center gap-3">
									<Badge variant="secondary">
										Using env var ({provider?.envVar})
									</Badge>
								</div>
							) : null}
							{(providerCredStatus?.activeSource === "none" || isUpdatingKey) && (
								<div className="flex items-center gap-2">
									<Input
										type="password"
										autoComplete="off"
										aria-label={`API key for ${provider?.name ?? selectedProvider}`}
										placeholder={isUpdatingKey ? "Enter new API key" : "Enter your API key"}
										value={apiKeyInput}
										onChange={(e) => setApiKeyInput(e.target.value)}
									/>
									<Button
										size="sm"
										onClick={() => {
											if (!apiKeyInput) return;
											setCredentialError(null);
											saveCredential.mutate(
												{ provider: selectedProvider, apiKey: apiKeyInput },
												{
													onSuccess: () => {
														setApiKeyInput("");
														setIsUpdatingKey(false);
													},
													onError: (err) =>
														setCredentialError(
															err instanceof Error ? err.message : "Failed to save credential",
														),
												},
											);
										}}
										disabled={saveCredential.isPending || !apiKeyInput}
									>
										{saveCredential.isPending ? (
											<Loader2 className="h-3 w-3 animate-spin" />
										) : (
											"Save"
										)}
									</Button>
									{isUpdatingKey && (
										<Button
											variant="ghost"
											size="sm"
											onClick={() => {
												setIsUpdatingKey(false);
												setApiKeyInput("");
												setCredentialError(null);
											}}
										>
											Cancel
										</Button>
									)}
								</div>
							)}
							{provider?.helpUrl && providerCredStatus?.activeSource === "none" && !isUpdatingKey && (
								<p className="text-xs text-muted-foreground">
									Get a key:{" "}
									<a
										href={provider.helpUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-primary hover:underline"
									>
										{provider.helpUrl}
									</a>
								</p>
							)}
						</div>
					)}

					{/* Configuration Options */}
					<div className="space-y-4 pt-4 border-t">

						{/* Temperature Slider */}
						<div className="space-y-3">
							<div className="flex items-center justify-between">
								<Label>Temperature</Label>
								<span className="text-sm text-muted-foreground">
									{temperature.toFixed(2)}
								</span>
							</div>
							<Slider
								value={[temperature]}
								onValueChange={([value]) => setTemperature(value)}
								min={0}
								max={2}
								step={0.05}
							/>
							<p className="text-xs text-muted-foreground">
								Lower values produce more focused outputs, higher values produce
								more creative outputs.
							</p>
						</div>

						{/* Max Tokens (optional) */}
						<div className="space-y-2">
							<Label>Max Tokens (optional)</Label>
							<Input
								type="number"
								placeholder="Default (no limit)"
								value={maxTokens ?? ""}
								onChange={(e) =>
									setMaxTokens(
										e.target.value ? parseInt(e.target.value) : undefined,
									)
								}
							/>
							<p className="text-xs text-muted-foreground">
								Maximum number of tokens to generate per response. Leave empty
								for model default.
							</p>
						</div>

						{/* Advanced Options (JSON) */}
						<Collapsible
							open={advancedOptionsOpen}
							onOpenChange={setAdvancedOptionsOpen}
						>
							<CollapsibleTrigger asChild>
								<Button variant="ghost" className="w-full justify-between">
									<span>Advanced Options (JSON)</span>
									{advancedOptionsOpen ? (
										<ChevronUp className="h-4 w-4" />
									) : (
										<ChevronDown className="h-4 w-4" />
									)}
								</Button>
							</CollapsibleTrigger>
							<CollapsibleContent className="pt-2">
								<Textarea
									placeholder='{"topP": 0.9, "stopSequences": ["\\n"]}'
									value={advancedOptions}
									onChange={(e) => setAdvancedOptions(e.target.value)}
									className="font-mono text-sm min-h-[100px]"
								/>
								<p className="text-xs text-muted-foreground mt-2">
									Provider-specific options in JSON format. These are passed
									directly to the LLM.
								</p>
							</CollapsibleContent>
						</Collapsible>

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
								disabled={testConnection.isPending || !canTest}
							>
								{testConnection.isPending ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<Sparkles className="mr-2 h-4 w-4" />
								)}
								Test Connection
							</Button>
							<Button
								onClick={handleSaveSettings}
								disabled={updateSettings.isPending || !canSave}
							>
								{updateSettings.isPending && (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								)}
								Save & Set Active
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Per-Agent Overrides Card */}
			<Card>
				<Collapsible
					open={agentOverridesOpen}
					onOpenChange={setAgentOverridesOpen}
				>
					<CardHeader
						className="cursor-pointer"
						onClick={() => setAgentOverridesOpen(!agentOverridesOpen)}
					>
						<CollapsibleTrigger asChild>
							<div className="flex items-center justify-between">
								<div>
									<CardTitle className="text-base">
										Per-Agent Overrides
									</CardTitle>
									<CardDescription>
										Optionally customize model settings for each agent type
									</CardDescription>
								</div>
								{agentOverridesOpen ? (
									<ChevronUp className="h-5 w-5 text-muted-foreground" />
								) : (
									<ChevronDown className="h-5 w-5 text-muted-foreground" />
								)}
							</div>
						</CollapsibleTrigger>
					</CardHeader>
					<CollapsibleContent>
						<CardContent className="pt-0">
							<div className="space-y-3">
								{AGENTS.map((agent) => {
									const override = settings?.agentOverrides?.[agent.id];
									const agentProvider =
										agentProviders[agent.id] ||
										settings?.activeProvider ||
										"anthropic";

									return (
										<AgentOverrideItem
											key={agent.id}
											agent={agent}
											override={override}
											isExpanded={expandedAgent === agent.id}
											onToggle={(open) =>
												setExpandedAgent(open ? agent.id : null)
											}
											agentProvider={agentProvider}
											onProviderChange={(p) =>
												setAgentProviders((prev) => ({
													...prev,
													[agent.id]: p,
												}))
											}
											onModelChange={(model) => {
												updateSettings.mutate({
													agentOverrides: {
														[agent.id]: {
															...override,
															model: model || undefined,
														},
													},
												});
											}}
											onTemperatureChange={(temp) => {
												updateSettings.mutate({
													agentOverrides: {
														[agent.id]: {
															...override,
															temperature: temp,
														},
													},
												});
											}}
											onReset={() => {
												updateSettings.mutate({
													agentOverrides: {
														[agent.id]: undefined,
													},
												});
											}}
											providers={providerInfos}
											models={allModels}
											envStatus={envStatusMap}
										/>
									);
								})}
							</div>
						</CardContent>
					</CollapsibleContent>
				</Collapsible>
			</Card>
		</div>
	);
}
