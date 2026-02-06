"use client";

import { useState } from "react";
import { LLM_PROVIDERS, type LLMProviderId } from "@prismalens/config/browser";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
	useMarkStepSkipped,
	useSaveLlmCredential,
	useTestLlmConnectionWithEnv,
	useUpdateLlmSettings,
} from "@/lib/api/hooks";

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
	const [error, setError] = useState<string | null>(null);

	// Form state - default to first provider
	const defaultProvider = AI_PROVIDERS[0];
	const [selectedProvider, setSelectedProvider] = useState<string>(
		defaultProvider?.id || "anthropic",
	);
	const [apiKey, setApiKey] = useState("");
	const [selectedModel, setSelectedModel] = useState<string>(
		defaultProvider?.models[0] || "",
	);
	const [testSuccess, setTestSuccess] = useState<boolean | null>(null);

	// oRPC mutations
	const updateSettings = useUpdateLlmSettings();
	const saveCredential = useSaveLlmCredential();
	const testConnection = useTestLlmConnectionWithEnv();
	const markSkipped = useMarkStepSkipped();

	const isLoading =
		updateSettings.isPending ||
		saveCredential.isPending ||
		testConnection.isPending ||
		markSkipped.isPending;

	const provider = AI_PROVIDERS.find((p) => p.id === selectedProvider);

	const handleTestConnection = async () => {
		setError(null);
		setTestSuccess(null);

		testConnection.mutate(
			{
				provider: selectedProvider as Parameters<typeof testConnection.mutate>[0]["provider"],
				model: selectedModel || undefined,
			},
			{
				onSuccess: (data) => {
					if (data.success) {
						setTestSuccess(true);
					} else {
						setTestSuccess(false);
						setError(data.error || "Connection test failed");
					}
				},
				onError: (err) => {
					setTestSuccess(false);
					setError(
						err instanceof Error ? err.message : "Connection test failed",
					);
				},
			},
		);
	};

	const handleSkip = async () => {
		try {
			await markSkipped.mutateAsync({ step: "ai" });
			onSkip?.();
			onComplete();
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to skip step";
			setError(message);
		}
	};

	const handleSubmit = async () => {
		setError(null);

		try {
			// Save API key via encrypted credential endpoint (if provided)
			if (apiKey && !provider?.noApiKey) {
				await saveCredential.mutateAsync({
					provider: selectedProvider as Parameters<typeof saveCredential.mutateAsync>[0]["provider"],
					apiKey,
				});
			}

			// Save provider config and set as active
			await updateSettings.mutateAsync({
				activeProvider: selectedProvider as Parameters<typeof updateSettings.mutateAsync>[0]["activeProvider"],
				providers: {
					[selectedProvider]: {
						model: selectedModel,
						...(provider?.baseUrlRequired
							? { baseUrl: provider.defaultBaseUrl || "http://localhost:11434" }
							: {}),
					},
				},
			});

			onComplete();
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to configure AI provider";
			setError(message);
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
				{error && (
					<div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-3">
						<AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
						<p className="text-sm text-destructive">{error}</p>
					</div>
				)}

				{/* Provider Selection */}
				<div className="space-y-3">
					<Label>Select Provider</Label>
					<div className="grid grid-cols-2 gap-3">
						{AI_PROVIDERS.map((p) => (
							<button
								key={p.id}
								type="button"
								onClick={() => {
									setSelectedProvider(p.id);
									setSelectedModel(p.models[0]);
									setApiKey("");
									setTestSuccess(null);
								}}
								className={cn(
									"p-4 rounded-lg border-2 text-left transition-colors",
									selectedProvider === p.id
										? "border-primary bg-primary/5"
										: "border-muted hover:border-muted-foreground/50",
								)}
							>
								<div className="flex items-center justify-between">
									<span className="font-medium">{p.name}</span>
								</div>
								{p.noApiKey && (
									<p className="text-xs text-muted-foreground mt-1">
										No API key required
									</p>
								)}
							</button>
						))}
					</div>
				</div>

				{/* API Key */}
				{!provider?.noApiKey && (
					<div className="space-y-2">
						<Label htmlFor="apiKey">API Key</Label>
						<Input
							id="apiKey"
							type="password"
							value={apiKey}
							onChange={(e) => {
								setApiKey(e.target.value);
								setTestSuccess(null);
							}}
							placeholder="Enter your API key"
						/>
						{provider?.helpUrl && (
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

				{/* Model Selection */}
				<div className="space-y-2">
					<Label>Model</Label>
					<Select value={selectedModel} onValueChange={setSelectedModel}>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{provider?.models.map((model) => (
								<SelectItem key={model} value={model}>
									{model}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{/* Test Connection Result */}
				{testSuccess !== null && (
					<div
						className={cn(
							"p-3 rounded-lg flex items-center gap-2",
							testSuccess
								? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
								: "bg-destructive/10 text-destructive",
						)}
					>
						{testSuccess ? (
							<>
								<CheckCircle className="h-4 w-4" />
								<span className="text-sm">Connection successful!</span>
							</>
						) : (
							<>
								<AlertCircle className="h-4 w-4" />
								<span className="text-sm">Connection failed</span>
							</>
						)}
					</div>
				)}

				{/* Actions */}
				<div className="flex gap-3">
					<Button
						variant="ghost"
						onClick={handleSkip}
						disabled={isLoading}
					>
						{markSkipped.isPending ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : null}
						Skip for now
					</Button>
					<Button
						variant="outline"
						onClick={handleTestConnection}
						disabled={isLoading || (!provider?.noApiKey && !apiKey)}
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
						disabled={isLoading || (!provider?.noApiKey && !apiKey)}
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
