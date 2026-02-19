import { Injectable, Inject, forwardRef, Logger } from "@nestjs/common";
import {
	createLLM,
	type LLMProviderConfig,
	getModelsForProvider,
	getModelsRegistry,
} from "@prismalens/agents";
import { LLM_PROVIDERS, getApiKeyEnvVar, type LLMProviderId } from "@prismalens/config/llm";
import type {
	LlmProviderIdExtended,
	LlmSettings,
	UpdateLlmSettings,
} from "@prismalens/contracts/schemas";
import { PrismaService } from "../prisma/prisma.service.js";
import { CredentialsService } from "../../modules/integrations/crypto/credentials.service.js";

@Injectable()
export class LlmSettingsService {
	private readonly logger = new Logger(LlmSettingsService.name);

	private readonly LLM_SETTINGS_KEY = "LLM_SETTINGS";
	private readonly LLM_CREDENTIALS_KEY = "LLM_CREDENTIALS_ENCRYPTED";

	constructor(
		private prisma: PrismaService,
		@Inject(forwardRef(() => CredentialsService))
		private credentialsService: CredentialsService,
	) {}

	private getDefaultLlmSettings(): LlmSettings {
		return {
			activeProvider: null,
			providers: {} as Record<LlmProviderIdExtended, { model: string }>,
			agentOverrides: undefined,
		};
	}

	async getLlmEnvStatus() {
		const providerIds = Object.keys(LLM_PROVIDERS) as LLMProviderId[];
		const providers: Record<
			string,
			{ hasApiKey: boolean; envVarName: string | null; isReady: boolean }
		> = {};

		for (const providerId of providerIds) {
			const providerMeta = LLM_PROVIDERS[providerId];
			const envVarName = providerMeta.envVar;

			const hasApiKey = envVarName ? !!process.env[envVarName] : false;

			let isReady = false;

			if (providerId === "ollama") {
				if (hasApiKey) {
					isReady = true;
				} else {
					isReady = await this.checkOllamaHealth();
				}
			} else {
				isReady = hasApiKey;
			}

			providers[providerId] = {
				hasApiKey,
				envVarName,
				isReady,
			};
		}

		const activeEnvProvider = process.env.PRISMALENS_LLM_PROVIDER || null;

		return {
			providers,
			activeEnvProvider,
		};
	}

	/**
	 * Check if local Ollama instance is running by pinging its API.
	 */
	async checkOllamaHealth(): Promise<boolean> {
		const baseUrl =
			process.env.PRISMALENS_OLLAMA_BASE_URL || "http://localhost:11434";

		// SSRF protection: only allow http/https protocols
		try {
			const parsed = new URL(baseUrl);
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				return false;
			}
		} catch {
			return false;
		}

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 2000);

			const response = await fetch(`${baseUrl}/api/tags`, {
				signal: controller.signal,
			});
			clearTimeout(timeoutId);

			return response.ok;
		} catch {
			return false;
		}
	}

	async getLlmSettings(): Promise<LlmSettings> {
		const setting = await this.prisma.setting.findUnique({
			where: { key: this.LLM_SETTINGS_KEY },
		});

		if (!setting) {
			return this.getDefaultLlmSettings();
		}

		try {
			const parsed = JSON.parse(setting.value);
			return {
				activeProvider: parsed.activeProvider ?? null,
				providers: parsed.providers ?? {},
				agentOverrides: parsed.agentOverrides,
			};
		} catch {
			return this.getDefaultLlmSettings();
		}
	}

	async updateLlmSettings(dto: UpdateLlmSettings): Promise<LlmSettings> {
		const current = await this.getLlmSettings();

		const updatedProviders = { ...current.providers };
		if (dto.providers) {
			for (const [providerId, providerConfig] of Object.entries(
				dto.providers,
			)) {
				const existing = updatedProviders[providerId as LlmProviderIdExtended];
				const existingModel = existing?.model ?? "";
				updatedProviders[providerId as LlmProviderIdExtended] = {
					...existing,
					...providerConfig,
					model: providerConfig?.model ?? existingModel,
				};
			}
		}

		let updatedAgentOverrides = current.agentOverrides;
		if (dto.agentOverrides !== undefined) {
			updatedAgentOverrides = dto.agentOverrides
				? {
						...current.agentOverrides,
						...dto.agentOverrides,
					}
				: undefined;
		}

		const updated: LlmSettings = {
			activeProvider: dto.activeProvider ?? current.activeProvider,
			providers: updatedProviders,
			agentOverrides: updatedAgentOverrides,
		};

		await this.prisma.setting.upsert({
			where: { key: this.LLM_SETTINGS_KEY },
			update: { value: JSON.stringify(updated), type: "json", category: "ai" },
			create: {
				key: this.LLM_SETTINGS_KEY,
				value: JSON.stringify(updated),
				type: "json",
				category: "ai",
			},
		});

		return updated;
	}

	async getAvailableModels(provider?: string) {
		try {
			if (provider) {
				const models = await getModelsForProvider(provider);
				return { models };
			}
			const models = await getModelsRegistry();
			return { models };
		} catch (error) {
			this.logger.error("Failed to fetch models from registry:", error);
			return { models: [] };
		}
	}

	async testLlmConnectionWithEnv(
		provider: LlmProviderIdExtended,
		model?: string,
	): Promise<{ success: boolean; error?: string }> {
		try {
			const providerMeta = LLM_PROVIDERS[provider as LLMProviderId];
			if (!providerMeta) {
				return { success: false, error: `Unknown provider: ${provider}` };
			}

			const envVarName = providerMeta.envVar;
			const apiKey = envVarName ? process.env[envVarName] : undefined;

			if (envVarName && !apiKey) {
				return {
					success: false,
					error: `API key not configured. Set ${envVarName} environment variable.`,
				};
			}

			let testModel = model;
			if (!testModel) {
				const settings = await this.getLlmSettings();
				testModel = settings.providers[provider]?.model;
			}
			if (!testModel) {
				testModel = providerMeta.suggestedModels[0];
			}

			const baseUrl = provider === "ollama"
				? (process.env.PRISMALENS_OLLAMA_BASE_URL || "http://localhost:11434")
				: undefined;

			const llmConfig = {
				provider,
				model: testModel,
				apiKey,
				...(baseUrl && { baseUrl }),
				temperature: 0,
				maxTokens: 50,
			} as LLMProviderConfig;

			const llm = createLLM(llmConfig);
			await llm.invoke('Reply with just "OK" to confirm connection.');

			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Connection failed",
			};
		}
	}

	// =========================================================================
	// LLM CREDENTIAL STORAGE + ENV BRIDGE
	// =========================================================================

	async saveLlmCredential(providerId: LLMProviderId, apiKey: string): Promise<void> {
		const existing = await this.getLlmCredentialMap(true);
		const credMap = { ...existing, [providerId]: apiKey };

		const encrypted = this.credentialsService.encrypt(credMap);
		await this.prisma.setting.upsert({
			where: { key: this.LLM_CREDENTIALS_KEY },
			update: { value: encrypted },
			create: {
				key: this.LLM_CREDENTIALS_KEY,
				value: encrypted,
				type: "encrypted",
				category: "ai",
			},
		});

		const envVar = getApiKeyEnvVar(providerId);
		if (envVar) {
			process.env[envVar] = apiKey;
		}
	}

	async deleteLlmCredential(providerId: LLMProviderId): Promise<void> {
		const existing = await this.getLlmCredentialMap();
		const { [providerId]: _removed, ...credMap } = existing;

		if (Object.keys(credMap).length === 0) {
			await this.prisma.setting.deleteMany({
				where: { key: this.LLM_CREDENTIALS_KEY },
			});
		} else {
			const encrypted = this.credentialsService.encrypt(credMap);
			await this.prisma.setting.update({
				where: { key: this.LLM_CREDENTIALS_KEY },
				data: { value: encrypted },
			});
		}

		const envVar = getApiKeyEnvVar(providerId);
		if (envVar) {
			delete process.env[envVar];
		}
	}

	async loadLlmCredentialsToEnv(): Promise<void> {
		const credMap = await this.getLlmCredentialMap();
		let loaded = 0;

		for (const [providerId, apiKey] of Object.entries(credMap)) {
			const envVar = getApiKeyEnvVar(providerId as LLMProviderId);
			if (envVar && apiKey) {
				process.env[envVar] = apiKey;
				loaded++;
			}
		}

		if (loaded > 0) {
			this.logger.log(`Loaded ${loaded} encrypted LLM credential(s) into env`);
		}
	}

	resolveApiKey(providerId: LLMProviderId): string | null {
		const envVar = getApiKeyEnvVar(providerId);
		if (!envVar) return null;
		return process.env[envVar] ?? null;
	}

	async getLlmCredentialStatus(): Promise<
		Record<string, { hasDbKey: boolean; hasEnvKey: boolean; activeSource: "db" | "env" | "none" }>
	> {
		const credMap = await this.getLlmCredentialMap();
		const providerIds = Object.keys(LLM_PROVIDERS) as LLMProviderId[];
		const result: Record<string, { hasDbKey: boolean; hasEnvKey: boolean; activeSource: "db" | "env" | "none" }> = {};

		for (const id of providerIds) {
			const hasDbKey = !!credMap[id];
			const envVar = getApiKeyEnvVar(id);
			const hasEnvKey = envVar ? !!process.env[envVar] : false;

			let activeSource: "db" | "env" | "none" = "none";
			if (hasDbKey) {
				activeSource = "db";
			} else if (hasEnvKey) {
				activeSource = "env";
			}

			result[id] = { hasDbKey, hasEnvKey, activeSource };
		}

		return result;
	}

	private async getLlmCredentialMap(throwOnError = false): Promise<Record<string, string>> {
		const setting = await this.prisma.setting.findUnique({
			where: { key: this.LLM_CREDENTIALS_KEY },
		});

		if (!setting) return {};

		try {
			return this.credentialsService.decrypt<Record<string, string>>(setting.value);
		} catch (error) {
			this.logger.error("Failed to decrypt LLM credentials", error);
			if (throwOnError) {
				throw new Error("Failed to decrypt existing LLM credentials. The encryption key may have changed.");
			}
			return {};
		}
	}
}
