"use client";

import { useMemo, useState } from "react";
import { LLM_PROVIDERS, type LLMProviderId } from "@prismalens/config/llm";
import {
	AlertCircle,
	ArrowRight,
	Bot,
	CheckCircle,
	Loader2,
	Sparkles,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
	useMarkStepSkipped,
	useOllamaModels,
	useSetupLlmEnvStatus,
	useSetupLlmModels,
	useSetupSaveLlmCredential,
	useSetupTestLlmConnection,
	useSetupUpdateLlmSettings,
} from "@/lib/api/hooks";
import {
	ProviderModelSelector,
	type ProviderInfo,
} from "@/components/settings/ProviderModelSelector";

// Transform LLM_PROVIDERS from config into UI-friendly format
const PROVIDERS: ProviderInfo[] = Object.values(LLM_PROVIDERS).map(
	(provider) => ({
		id: provider.id as LLMProviderId,
		name: provider.name,
		free: "free" in provider ? provider.free : false,
		baseUrlRequired: "baseUrlRequired" in provider ? provider.baseUrlRequired : undefined,
		defaultBaseUrl: "defaultBaseUrl" in provider ? (provider.defaultBaseUrl as string) : undefined,
	}),
);

// Provider metadata for API key / base URL handling
const PROVIDER_META = Object.fromEntries(
	Object.values(LLM_PROVIDERS).map((p) => [
		p.id,
		{
			helpUrl: p.helpUrl,
			noApiKey: p.envVar === null,
			baseUrlRequired: "baseUrlRequired" in p ? p.baseUrlRequired : false,
			defaultBaseUrl: "defaultBaseUrl" in p ? p.defaultBaseUrl : undefined,
		},
	]),
);

export interface SetupStepLLMProps {
	onComplete: () => void;
	onSkip?: () => void;
	onError?: (error: string) => void;
}

export function SetupStepLLM({
	onComplete,
	onSkip,
	onError,
}: SetupStepLLMProps) {
	const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

	// Form state
	const [selectedProvider, setSelectedProvider] =
		useState<LLMProviderId>("anthropic");
	const [apiKey, setApiKey] = useState("");
	const [selectedModel, setSelectedModel] = useState("");
	const [customModel, setCustomModel] = useState("");
	const [baseUrl, setBaseUrl] = useState("");

	// API data (public setup endpoints — no auth required)
	const { data: envStatus } = useSetupLlmEnvStatus();
	const { data: modelsData, isLoading: modelsLoading } = useSetupLlmModels();

	// oRPC mutations (use setup-specific public endpoints — no auth required)
	const updateSettings = useSetupUpdateLlmSettings();
	const saveCredential = useSetupSaveLlmCredential();
	const testConnection = useSetupTestLlmConnection();
	const markSkipped = useMarkStepSkipped();

	const isLoading =
		updateSettings.isPending ||
		saveCredential.isPending ||
		testConnection.isPending ||
		markSkipped.isPending;

	const meta = PROVIDER_META[selectedProvider];
	const effectiveBaseUrl = baseUrl || meta?.defaultBaseUrl;
	const { data: ollamaModels } = useOllamaModels(
		selectedProvider === "ollama" ? effectiveBaseUrl : undefined,
	);

	// Merge cloud models (models.dev) with local Ollama models
	const allModels = useMemo(
		() => [...(modelsData?.models || []), ...(ollamaModels || [])],
		[modelsData?.models, ollamaModels],
	);
	const activeModel = customModel || selectedModel;

	// During setup, all providers are "ready" so model selection isn't blocked.
	// The user enters their API key separately below — validation happens on submit.
	const envStatusMap: Record<string, { isReady: boolean; envVarName?: string }> =
		envStatus?.providers
			? Object.fromEntries(
					Object.entries(envStatus.providers).map(([id, status]) => {
						const s = status as { isReady: boolean; envVarName: string | null };
						return [
							id,
							{
								isReady: true,
								envVarName: s.envVarName ?? undefined,
							},
						];
					}),
				)
			: {};

	const handleTestConnection = async () => {
		setStatus(null);

		try {
			// Save API key first so the backend can use it
			if (apiKey && !meta?.noApiKey) {
				await saveCredential.mutateAsync({
					provider: selectedProvider,
					apiKey,
				});
			}

			const data = await testConnection.mutateAsync({
				provider: selectedProvider,
				model: activeModel || undefined,
				baseUrl: effectiveBaseUrl || undefined,
			});

			if (data.success) {
				setStatus({ type: "success", message: "Connection successful!" });
			} else {
				setStatus({ type: "error", message: data.error || "Connection test failed" });
			}
		} catch (err) {
			setStatus({
				type: "error",
				message: err instanceof Error ? err.message : "Connection test failed",
			});
		}
	};

	const handleSkip = async () => {
		try {
			await markSkipped.mutateAsync({ step: "ai" });
			onSkip?.();
			onComplete();
		} catch (err) {
			setStatus({
				type: "error",
				message: err instanceof Error ? err.message : "Failed to skip step",
			});
		}
	};

	const handleSubmit = async () => {
		setStatus(null);

		try {
			// Save API key via encrypted credential endpoint (if provided)
			if (apiKey && !meta?.noApiKey) {
				await saveCredential.mutateAsync({
					provider: selectedProvider,
					apiKey,
				});
			}

			// Save provider config and set as active
			await updateSettings.mutateAsync({
				activeProvider: selectedProvider,
				providers: {
					[selectedProvider]: {
						model: activeModel,
						...(meta?.defaultBaseUrl || baseUrl
							? {
									baseUrl:
										baseUrl ||
										(meta?.defaultBaseUrl as string),
								}
							: {}),
					},
				},
			});

			onComplete();
		} catch (err) {
			const message =
				err instanceof Error
					? err.message
					: "Failed to configure AI provider";
			setStatus({ type: "error", message });
			onError?.(message);
		}
	};

	return (
		<Card>
			<CardHeader className="text-center">
				<div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
					<Bot className="h-8 w-8 text-primary" />
				</div>
				<CardTitle>Configure AI Provider</CardTitle>
				<CardDescription>
					PrismaLens uses LLMs to analyze incidents and identify root causes
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{/* Provider & Model Selection */}
				<div className="space-y-3">
					<Label>Select Provider & Model</Label>
					{modelsLoading ? (
						<div className="h-[300px] border rounded-lg flex items-center justify-center">
							<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
						</div>
					) : (
						<ProviderModelSelector
							providers={PROVIDERS}
							models={allModels}
							envStatus={envStatusMap}
							hideStatusIcons
							selectedProvider={selectedProvider}
							selectedModel={selectedModel}
							customModel={customModel}
							baseUrl={baseUrl}
							onProviderChange={(p) => {
								setSelectedProvider(p as LLMProviderId);
								setSelectedModel("");
								setCustomModel("");
								setBaseUrl("");
								setApiKey("");
								setStatus(null);
							}}
							onModelChange={(model) => {
								setSelectedModel(model);
								setCustomModel("");
							}}
							onCustomModelChange={setCustomModel}
							onBaseUrlChange={setBaseUrl}
						/>
					)}
				</div>

				{/* API Key */}
				{!meta?.noApiKey && (
					<div className="space-y-2">
						<Label htmlFor="apiKey">API Key</Label>
						<Input
							id="apiKey"
							type="password"
							value={apiKey}
							onChange={(e) => {
								setApiKey(e.target.value);
								setStatus(null);
							}}
							placeholder="Enter your API key"
						/>
						{meta?.helpUrl && (
							<p className="text-xs text-muted-foreground">
								Get a key:{" "}
								<a
									href={meta.helpUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="text-primary hover:underline"
								>
									{meta.helpUrl}
								</a>
							</p>
						)}
					</div>
				)}

				{/* Status (success/error) */}
				{status && (
					<div
						className={cn(
							"p-3 rounded-lg flex items-center gap-2",
							status.type === "success"
								? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
								: "bg-destructive/10 text-destructive",
						)}
					>
						{status.type === "success" ? (
							<CheckCircle className="h-4 w-4" />
						) : (
							<AlertCircle className="h-4 w-4" />
						)}
						<span className="text-sm">{status.message}</span>
					</div>
				)}

				{/* Actions */}
				<div className="flex gap-3">
					<Button variant="ghost" onClick={handleSkip} disabled={isLoading}>
						{markSkipped.isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : null}
						Skip for now
					</Button>
					<Button
						variant="outline"
						onClick={handleTestConnection}
						disabled={isLoading || (!meta?.noApiKey && !apiKey)}
					>
						{testConnection.isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Sparkles className="mr-2 h-4 w-4" />
						)}
						Test Connection
					</Button>
					<Button
						className="flex-1"
						onClick={() => handleSubmit()}
						disabled={isLoading || (!meta?.noApiKey && !apiKey) || !activeModel}
					>
						{updateSettings.isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<>
								Continue
								<ArrowRight className="ml-2 h-4 w-4" />
							</>
						)}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
