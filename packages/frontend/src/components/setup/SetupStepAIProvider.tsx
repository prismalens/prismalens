// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Wizard step 2 — the model that will run investigations (#332).
 *
 * This is a thin composition over the Settings → AI Provider machinery, not a
 * second implementation of it: the same `ProviderModelSelector`, the same
 * `useSaveLlmCredential` / `useTestLlmConnectionWithEnv` / `useUpdateLlmSettings`
 * hooks, therefore the same server path.
 *
 * D11 — no new credential path. The key travels
 *   useSaveLlmCredential → POST /settings/llm/credentials
 *     → LlmSettingsService.saveLlmCredential → CredentialsService.encryptToBase64
 *       → TokenVault (AES-256-GCM) → Setting row `LLM_CREDENTIALS_ENCRYPTED`.
 * The wizard never reads or writes the CLI's `auth.json`, and holds the key in
 * component state only until the request returns.
 */

import { LLM_PROVIDERS, type LLMProviderId } from "@prismalens/config/llm";
import {
	AlertCircle,
	Bot,
	CheckCircle,
	Loader2,
	Sparkles,
	Terminal,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
	type ProviderInfo,
	ProviderModelSelector,
} from "@/components/settings/ProviderModelSelector";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	useHarnesses,
	useLlmCredentialStatus,
	useLlmEnvStatus,
	useLlmModels,
	useLlmSettings,
	useOllamaModels,
	useSaveLlmCredential,
	useTestLlmConnectionWithEnv,
	useUpdateLlmSettings,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

export interface SetupStepAIProviderProps {
	/** Advance the wizard — called once the provider is genuinely usable. */
	onComplete: () => void;
	/** Move on without configuring anything. */
	onSkip: () => void;
}

export function SetupStepAIProvider({
	onComplete,
	onSkip,
}: SetupStepAIProviderProps) {
	const { data: envStatus, isLoading: envLoading } = useLlmEnvStatus();
	const { data: settings, isLoading: settingsLoading } = useLlmSettings();
	const { data: modelsData, isLoading: modelsLoading } = useLlmModels();
	const { data: credentialStatus } = useLlmCredentialStatus();
	const { data: harnessData } = useHarnesses();

	const saveCredential = useSaveLlmCredential();
	const testConnection = useTestLlmConnectionWithEnv();
	const updateSettings = useUpdateLlmSettings();

	const [selectedProvider, setSelectedProvider] =
		useState<LLMProviderId>("anthropic");
	const [selectedModel, setSelectedModel] = useState("");
	const [customModel, setCustomModel] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [tested, setTested] = useState(false);

	const providerMeta = LLM_PROVIDERS[selectedProvider];
	// Every provider names an `envVar`, so it cannot say whether a key is
	// REQUIRED — ollama and custom run keyless. Same SSOT flag the API's
	// isActiveProviderUsable reads, so the two agree (PR #396 threads A/B).
	const requiresApiKey = providerMeta.requiresApiKey;
	const credential = credentialStatus?.providers?.[selectedProvider];
	const storedKey = credential != null && credential.activeSource !== "none";

	const ollamaBaseUrl =
		selectedProvider === "ollama"
			? baseUrl || LLM_PROVIDERS.ollama.defaultBaseUrl
			: undefined;
	const { data: ollamaModels } = useOllamaModels(ollamaBaseUrl);

	const models = useMemo(
		() => [...(modelsData?.models ?? []), ...(ollamaModels ?? [])],
		[modelsData?.models, ollamaModels],
	);

	const providerInfos = useMemo<ProviderInfo[]>(
		() =>
			Object.values(LLM_PROVIDERS).map((config) => ({
				id: config.id as LLMProviderId,
				name: config.name,
				free: "free" in config ? Boolean(config.free) : false,
				baseUrlRequired:
					"baseUrlRequired" in config ? config.baseUrlRequired : undefined,
				defaultBaseUrl:
					"defaultBaseUrl" in config
						? (config.defaultBaseUrl as string)
						: undefined,
			})),
		[],
	);

	/**
	 * `ProviderModelSelector` reads `isReady` as "a key for this provider is in
	 * the ENVIRONMENT", and on that basis disables every model card and the
	 * manual model input, and shows a "Set ANTHROPIC_API_KEY to enable" banner.
	 *
	 * Both are wrong on THIS screen. The step's whole purpose is that the
	 * operator supplies the key through the UI, so reading the flag literally
	 * makes it unusable (no model can be picked, so "Test & continue" can never
	 * enable) and tells them to go set an environment variable while an API key
	 * field sits directly below.
	 *
	 * The wizard therefore drives the selector as a pure provider+model picker —
	 * everything selectable, no status icons — and keeps credential state in ONE
	 * place: the API key section under it, which already says "Stored
	 * (encrypted)" or "Using OPENAI_API_KEY" for the selected provider.
	 */
	const envStatusMap = useMemo<
		Record<string, { isReady: boolean; envVarName?: string }>
	>(
		() =>
			Object.fromEntries(
				(Object.keys(LLM_PROVIDERS) as LLMProviderId[]).map((id) => [
					id,
					{
						isReady: true,
						envVarName: envStatus?.providers?.[id]?.envVarName ?? undefined,
					},
				]),
			),
		[envStatus?.providers],
	);

	/**
	 * A signed-in Claude CLI session is a complete answer to this step — the
	 * harness authenticates through it, no key involved (ADR-0031, #501). Reports
	 * come back raw until a Tier-1 key exists, which is a supported free-tier state.
	 */
	const claudeSession = harnessData?.harnesses.find(
		(harness) =>
			harness.id === "claude-code" &&
			harness.verdict.usable &&
			harness.verdict.route === "cli-session",
	);

	const model = customModel || selectedModel;
	const busy =
		saveCredential.isPending ||
		testConnection.isPending ||
		updateSettings.isPending;
	// A key already in the environment (Docker/K8s secret) is a first-class
	// answer to this step — do not force the operator to paste it again.
	const keySatisfied = !requiresApiKey || storedKey || apiKey.trim().length > 0;
	const canContinue = keySatisfied && model.length > 0;

	function resetFeedback() {
		setError(null);
		setTested(false);
	}

	/**
	 * Persist anthropic with a default model so the setup step completes (#516).
	 * No key is saved or tested; the worker gate verifies CLI session auth.
	 */
	async function handleUseClaudeSession() {
		resetFeedback();
		try {
			await updateSettings.mutateAsync({
				activeProvider: "anthropic",
				providers: {
					anthropic: {
						model: model || LLM_PROVIDERS.anthropic.defaultModel,
					},
				},
			});
			onComplete();
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Could not save the Claude session as the provider. Try again.",
			);
		}
	}

	/**
	 * Save the key first, then test, then persist the active provider. The order
	 * matters: `testConnection` runs server-side against resolved credentials,
	 * so a key that only exists in this input has to be in the vault before the
	 * test can see it.
	 */
	async function handleContinue() {
		resetFeedback();
		try {
			// A keyless provider may still be given one (Ollama Cloud) — save
			// whatever was typed, never gate the save on requiredness.
			if (apiKey.trim()) {
				await saveCredential.mutateAsync({
					provider: selectedProvider,
					apiKey: apiKey.trim(),
				});
				// Do not keep the plaintext around once the vault has it.
				setApiKey("");
			}

			const result = await testConnection.mutateAsync({
				provider: selectedProvider,
				model,
			});
			if (!result.success) {
				setError(
					result.error ??
						"The provider rejected the test call. Check the key and model.",
				);
				return;
			}
			setTested(true);

			await updateSettings.mutateAsync({
				activeProvider: selectedProvider,
				providers: {
					[selectedProvider]: {
						model,
						...(baseUrl ? { baseUrl } : {}),
					},
				},
			});

			onComplete();
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Could not configure the provider. Try again.",
			);
		}
	}

	if (envLoading || settingsLoading) {
		return (
			<Card>
				<CardContent className="flex items-center justify-center py-16">
					<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader className="text-center">
				<div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
					<Bot className="h-8 w-8 text-primary" />
				</div>
				<CardTitle>
					{/* CardTitle renders a plain div, so the heading gives screen
					    readers (and the e2e spec) a real landmark for this step. */}
					<h2>Connect an AI provider</h2>
				</CardTitle>
				<CardDescription>
					Investigations are run by a model you supply. The key is encrypted
					(AES-256-GCM) and stored in this instance's database — never written
					to a file and never sent anywhere but the provider.
				</CardDescription>
			</CardHeader>

			<CardContent className="space-y-6">
				{settings?.activeProvider && (
					<div className="p-3 bg-muted/50 rounded-lg text-sm flex items-center gap-2">
						<CheckCircle className="h-4 w-4 text-muted-foreground" />
						<span className="text-muted-foreground">Current provider:</span>
						<span className="font-medium">
							{LLM_PROVIDERS[settings.activeProvider]?.name ??
								settings.activeProvider}
						</span>
						{settings.providers[settings.activeProvider]?.model && (
							<Badge variant="outline">
								{settings.providers[settings.activeProvider]?.model}
							</Badge>
						)}
					</div>
				)}

				{claudeSession && (
					<div
						className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3"
						data-testid="wizard-claude-session"
					>
						<div className="flex items-start gap-3">
							<Terminal className="h-5 w-5 text-primary shrink-0 mt-0.5" />
							<div className="space-y-1">
								<p className="font-medium">
									Use your Claude subscription — no API key needed
								</p>
								<p className="text-sm text-muted-foreground">
									PrismaLens found a signed-in Claude Code session on this
									machine. Investigations run through it. Reports come back as
									the agent wrote them until you add a provider key, which you
									can do any time in Settings.
								</p>
							</div>
						</div>
						<Button
							variant="outline"
							onClick={handleUseClaudeSession}
							disabled={busy}
						>
							{busy ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<Terminal className="mr-2 h-4 w-4" />
							)}
							Use my Claude subscription
						</Button>
					</div>
				)}

				<div className="space-y-3">
					<Label>Provider & model</Label>
					{modelsLoading ? (
						<div className="h-[300px] border rounded-lg flex items-center justify-center">
							<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
						</div>
					) : (
						<ProviderModelSelector
							providers={providerInfos}
							models={models}
							envStatus={envStatusMap}
							selectedProvider={selectedProvider}
							selectedModel={selectedModel}
							customModel={customModel}
							baseUrl={baseUrl}
							onProviderChange={(p) => {
								setSelectedProvider(p as LLMProviderId);
								setSelectedModel("");
								setCustomModel("");
								setApiKey("");
								resetFeedback();
							}}
							onModelChange={(m) => {
								setSelectedModel(m);
								setCustomModel("");
								resetFeedback();
							}}
							onCustomModelChange={(m) => {
								setCustomModel(m);
								resetFeedback();
							}}
							onBaseUrlChange={(url) => {
								setBaseUrl(url);
								resetFeedback();
							}}
							// See the note on `envStatusMap`: credential state belongs to the
							// API key section below, not to two disagreeing places.
							hideStatusIcons
						/>
					)}
				</div>

				{/* Shown whenever the provider can hold a key at all — a keyless one
				    accepts an optional key rather than demanding one. */}
				{providerMeta.envVar && (
					<div className="space-y-2">
						<Label htmlFor="setup-api-key">
							API key{requiresApiKey ? "" : " (optional)"}
						</Label>
						{storedKey ? (
							<div className="flex items-center gap-3">
								<Badge variant="secondary">
									<CheckCircle className="h-3 w-3 mr-1" />
									{credential?.activeSource === "env"
										? `Using ${providerMeta.envVar}`
										: "Stored (encrypted)"}
								</Badge>
								<span className="text-sm text-muted-foreground">
									Nothing to enter — continue to test it.
								</span>
							</div>
						) : (
							<>
								<Input
									id="setup-api-key"
									type="password"
									autoComplete="off"
									spellCheck={false}
									placeholder={`Paste your ${providerMeta.name} key`}
									value={apiKey}
									disabled={busy}
									onChange={(e) => {
										setApiKey(e.target.value);
										resetFeedback();
									}}
								/>
								{providerMeta.helpUrl && (
									<p className="text-xs text-muted-foreground">
										Get a key:{" "}
										<a
											href={providerMeta.helpUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="text-primary hover:underline"
										>
											{providerMeta.helpUrl}
										</a>
									</p>
								)}
							</>
						)}
					</div>
				)}

				{error && (
					<Alert variant="destructive">
						<AlertCircle className="h-4 w-4" />
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}

				{tested && !error && (
					<p
						role="status"
						className={cn(
							"flex items-center gap-2 text-sm",
							"text-emerald-700 dark:text-emerald-400",
						)}
					>
						<CheckCircle className="h-4 w-4" />
						Connection successful — saving as the active provider.
					</p>
				)}
			</CardContent>

			<CardFooter className="flex items-center justify-between gap-3">
				<Button variant="ghost" onClick={onSkip} disabled={busy}>
					Skip for now
				</Button>
				<Button onClick={handleContinue} disabled={busy || !canContinue}>
					{busy ? (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					) : (
						<Sparkles className="mr-2 h-4 w-4" />
					)}
					Test & continue
				</Button>
			</CardFooter>
		</Card>
	);
}
