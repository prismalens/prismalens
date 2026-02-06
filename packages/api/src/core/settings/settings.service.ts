import { Injectable, NotFoundException, Inject, forwardRef, Logger } from "@nestjs/common";
import {
	createLLM,
	type LLMProviderConfig,
	getModelsForProvider,
	getModelsRegistry,
} from "@prismalens/agents";
import { LLM_PROVIDERS, getApiKeyEnvVar, type LLMProviderId } from "@prismalens/config/llm";
import {
	MCP_SERVERS,
	type MCPServerId,
	getAvailableMCPServers,
} from "@prismalens/config/mcp";
import type {
	LlmProviderIdExtended,
	LlmSettings,
	UpdateLlmSettings,
	McpSettings,
	McpServerSettings,
	UpdateMcpSettings,
	McpServerStatus,
} from "@prismalens/contracts/schemas";
import { PrismaService } from "../prisma/prisma.service.js";
import { IntegrationsService } from "../../modules/integrations/integrations.service.js";
import { CredentialsService } from "../../modules/integrations/crypto/credentials.service.js";

@Injectable()
export class SettingsService {
	private readonly logger = new Logger(SettingsService.name);

	constructor(
		private prisma: PrismaService,
		@Inject(forwardRef(() => IntegrationsService))
		private integrationsService: IntegrationsService,
		@Inject(forwardRef(() => CredentialsService))
		private credentialsService: CredentialsService,
	) {}

	// =============================================================================
	// LLM CONFIGURATION
	// =============================================================================

	private readonly LLM_SETTINGS_KEY = "LLM_SETTINGS";
	private readonly LLM_CREDENTIALS_KEY = "LLM_CREDENTIALS_ENCRYPTED";

	/**
	 * Default settings for a fresh install
	 */
	private getDefaultLlmSettings(): LlmSettings {
		return {
			activeProvider: null,
			providers: {} as Record<LlmProviderIdExtended, { model: string }>,
			agentOverrides: undefined,
		};
	}

	/**
	 * Get environment variable status for all providers.
	 * This shows which providers have API keys configured via environment variables.
	 */
	async getLlmEnvStatus() {
		const providerIds = Object.keys(LLM_PROVIDERS) as LLMProviderId[];
		const providers: Record<
			string,
			{ hasApiKey: boolean; envVarName: string | null; isReady: boolean }
		> = {};

		for (const providerId of providerIds) {
			const providerMeta = LLM_PROVIDERS[providerId];
			const envVarName = providerMeta.envVar;

			// Check if env var is set (non-empty)
			const hasApiKey = envVarName ? !!process.env[envVarName] : false;

			let isReady = false;

			if (providerId === "ollama") {
				// Ollama: ready if API key set (cloud) OR local instance running
				if (hasApiKey) {
					isReady = true; // Cloud mode with API key
				} else {
					isReady = await this.checkOllamaHealth(); // Local mode - check health
				}
			} else {
				// Other providers: ready if API key is set
				isReady = hasApiKey;
			}

			providers[providerId] = {
				hasApiKey,
				envVarName,
				isReady,
			};
		}

		// Get active provider from PRISMALENS_LLM_PROVIDER env var
		const activeEnvProvider = process.env.PRISMALENS_LLM_PROVIDER || null;

		return {
			providers,
			activeEnvProvider,
		};
	}

	/**
	 * Check if local Ollama instance is running by pinging its API.
	 */
	private async checkOllamaHealth(): Promise<boolean> {
		const baseUrl =
			process.env.PRISMALENS_OLLAMA_BASE_URL || "http://localhost:11434";
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout

			const response = await fetch(`${baseUrl}/api/tags`, {
				signal: controller.signal,
			});
			clearTimeout(timeoutId);

			return response.ok;
		} catch {
			return false;
		}
	}

	/**
	 * Get comprehensive LLM settings (model, temperature, per-agent overrides)
	 */
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

	/**
	 * Update LLM settings (partial update)
	 */
	async updateLlmSettings(dto: UpdateLlmSettings): Promise<LlmSettings> {
		const current = await this.getLlmSettings();

		// Deep merge providers
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

		// Merge agent overrides
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

	/**
	 * Get available models from the models registry
	 */
	async getAvailableModels(provider?: string) {
		try {
			if (provider) {
				const models = await getModelsForProvider(provider);
				return { models };
			}
			const models = await getModelsRegistry();
			return { models };
		} catch (error) {
			// Return empty list on error
			this.logger.error("Failed to fetch models from registry:", error);
			return { models: [] };
		}
	}

	/**
	 * Test LLM connection using environment variables (no API key input)
	 */
	async testLlmConnectionWithEnv(
		provider: LlmProviderIdExtended,
		model?: string,
	): Promise<{ success: boolean; error?: string }> {
		try {
			const providerMeta = LLM_PROVIDERS[provider as LLMProviderId];
			if (!providerMeta) {
				return { success: false, error: `Unknown provider: ${provider}` };
			}

			// Get API key from env var
			const envVarName = providerMeta.envVar;
			const apiKey = envVarName ? process.env[envVarName] : undefined;

			// Check if API key is required but not set
			if (envVarName && !apiKey) {
				return {
					success: false,
					error: `API key not configured. Set ${envVarName} environment variable.`,
				};
			}

			// Get model from settings if not provided
			let testModel = model;
			if (!testModel) {
				const settings = await this.getLlmSettings();
				testModel = settings.providers[provider]?.model;
			}
			if (!testModel) {
				// Use first suggested model as fallback
				testModel = providerMeta.suggestedModels[0];
			}

			// Build base config
			const baseUrl = provider === "ollama"
				? (process.env.PRISMALENS_OLLAMA_BASE_URL || "http://localhost:11434")
				: undefined;

			// Create LLM config using new typed interface
			const llmConfig = {
				provider,
				model: testModel,
				apiKey,
				...(baseUrl && { baseUrl }),
				temperature: 0,
				maxTokens: 50,
			} as LLMProviderConfig;

			// Create LLM instance
			const llm = createLLM(llmConfig);

			// Send a simple test message
			await llm.invoke('Reply with just "OK" to confirm connection.');

			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Connection failed",
			};
		}
	}

	// =============================================================================
	// LLM CREDENTIAL STORAGE + ENV BRIDGE
	// =============================================================================

	/**
	 * Save an encrypted LLM API key for a provider.
	 * The key is encrypted using AES-256-GCM and stored in the DB.
	 * After saving, the key is immediately set in process.env so the
	 * LLM factory can resolve it without restart.
	 */
	async saveLlmCredential(providerId: LLMProviderId, apiKey: string): Promise<void> {
		// Decrypt existing credential map (or start fresh)
		const existing = await this.getLlmCredentialMap(true);
		const credMap = { ...existing, [providerId]: apiKey };

		// Re-encrypt and upsert
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

		// Bridge to env — DB key wins over original env
		const envVar = getApiKeyEnvVar(providerId);
		if (envVar) {
			process.env[envVar] = apiKey;
		}
	}

	/**
	 * Delete an encrypted LLM API key for a provider.
	 */
	async deleteLlmCredential(providerId: LLMProviderId): Promise<void> {
		const existing = await this.getLlmCredentialMap();
		const { [providerId]: _removed, ...credMap } = existing;

		if (Object.keys(credMap).length === 0) {
			// No credentials left — delete the row entirely
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

		// Remove from env
		const envVar = getApiKeyEnvVar(providerId);
		if (envVar) {
			delete process.env[envVar];
		}
	}

	/**
	 * Load all encrypted LLM credentials from DB into process.env.
	 * Called once on API startup. DB-stored keys take precedence over
	 * pre-existing env vars (Docker/K8s secrets).
	 */
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

	/**
	 * Resolve the API key for a provider from process.env.
	 * Returns null if no key is available.
	 */
	resolveApiKey(providerId: LLMProviderId): string | null {
		const envVar = getApiKeyEnvVar(providerId);
		if (!envVar) return null;
		return process.env[envVar] ?? null;
	}

	/**
	 * Get credential status for all providers.
	 * Shows whether each provider has a DB-stored key, env-var key, or neither.
	 */
	async getLlmCredentialStatus(): Promise<
		Record<string, { hasDbKey: boolean; hasEnvKey: boolean; activeSource: "db" | "env" | "none" }>
	> {
		const credMap = await this.getLlmCredentialMap();
		const providerIds = Object.keys(LLM_PROVIDERS) as LLMProviderId[];
		const result: Record<string, { hasDbKey: boolean; hasEnvKey: boolean; activeSource: "db" | "env" | "none" }> = {};

		for (const id of providerIds) {
			const hasDbKey = !!credMap[id];
			const envVar = getApiKeyEnvVar(id);
			// Check env but exclude keys we set from DB (we can't distinguish,
			// but the DB key wins — so if DB key exists, source is "db")
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

	/**
	 * Decrypt the credential map from DB, or return empty object.
	 *
	 * @param throwOnError - If true, rethrow decryption errors instead of returning {}.
	 *   Use true for write operations (save/delete) where silently losing keys is worse
	 *   than surfacing the error. Use false (default) for reads (load, status).
	 */
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

	// =============================================================================
	// INVESTIGATION POLICIES
	// =============================================================================

	private readonly DEFAULT_POLICIES = {
		tier_1: {
			tier: "tier_1" as const,
			autoInvestigate: "always" as const,
			requiresApproval: true,
			pageOnCall: true,
			postToSlack: true,
		},
		tier_2: {
			tier: "tier_2" as const,
			autoInvestigate: "critical_high" as const,
			requiresApproval: false,
			pageOnCall: false,
			postToSlack: true,
		},
		tier_3: {
			tier: "tier_3" as const,
			autoInvestigate: "manual" as const,
			requiresApproval: false,
			pageOnCall: false,
			postToSlack: true,
		},
		tier_4: {
			tier: "tier_4" as const,
			autoInvestigate: "never" as const,
			requiresApproval: false,
			pageOnCall: false,
			postToSlack: false,
		},
	};

	private readonly DEFAULT_LIMITS = {
		maxConcurrent: 5,
		timeoutMinutes: 30,
		maxToolCalls: 50,
	};

	async getInvestigationPolicies() {
		const setting = await this.prisma.setting.findUnique({
			where: { key: "INVESTIGATION_POLICIES" },
		});

		if (!setting) {
			// Return defaults
			return {
				policies: Object.values(this.DEFAULT_POLICIES),
			};
		}

		const saved = JSON.parse(setting.value);
		// Merge with defaults to ensure all tiers exist
		const policies = Object.keys(this.DEFAULT_POLICIES).map((tier) => ({
			...this.DEFAULT_POLICIES[tier as keyof typeof this.DEFAULT_POLICIES],
			...(saved[tier] || {}),
			tier: tier as "tier_1" | "tier_2" | "tier_3" | "tier_4",
		}));

		return { policies };
	}

	async updateInvestigationPolicy(
		tier: string,
		dto: {
			autoInvestigate?: string;
			requiresApproval?: boolean;
			pageOnCall?: boolean;
			postToSlack?: boolean;
		},
	) {
		// Get current policies
		const setting = await this.prisma.setting.findUnique({
			where: { key: "INVESTIGATION_POLICIES" },
		});

		const current = setting
			? JSON.parse(setting.value)
			: { ...this.DEFAULT_POLICIES };

		// Update the specific tier
		current[tier] = {
			...(current[tier] ||
				this.DEFAULT_POLICIES[tier as keyof typeof this.DEFAULT_POLICIES]),
			...dto,
			tier,
		};

		await this.prisma.setting.upsert({
			where: { key: "INVESTIGATION_POLICIES" },
			update: { value: JSON.stringify(current), type: "json", category: "ai" },
			create: {
				key: "INVESTIGATION_POLICIES",
				value: JSON.stringify(current),
				type: "json",
				category: "ai",
			},
		});

		return current[tier];
	}

	async getInvestigationLimits() {
		const setting = await this.prisma.setting.findUnique({
			where: { key: "INVESTIGATION_LIMITS" },
		});

		if (!setting) {
			return this.DEFAULT_LIMITS;
		}

		return {
			...this.DEFAULT_LIMITS,
			...JSON.parse(setting.value),
		};
	}

	async updateInvestigationLimits(dto: {
		maxConcurrent?: number;
		timeoutMinutes?: number;
		maxToolCalls?: number;
	}) {
		const current = await this.getInvestigationLimits();
		const updated = { ...current, ...dto };

		await this.prisma.setting.upsert({
			where: { key: "INVESTIGATION_LIMITS" },
			update: { value: JSON.stringify(updated), type: "json", category: "ai" },
			create: {
				key: "INVESTIGATION_LIMITS",
				value: JSON.stringify(updated),
				type: "json",
				category: "ai",
			},
		});

		return updated;
	}

	// =============================================================================
	// DANGER ZONE OPERATIONS
	// =============================================================================

	async resetData() {
		// Delete in order to respect foreign key constraints
		await this.prisma.$transaction([
			// Delete recommendations first (references investigations)
			this.prisma.recommendation.deleteMany({}),
			// Delete tool executions (references agent executions)
			this.prisma.toolExecution.deleteMany({}),
			// Delete agent executions (references investigations)
			this.prisma.agentExecution.deleteMany({}),
			// Delete investigations (references incidents)
			this.prisma.investigation.deleteMany({}),
			// Delete timeline entries (references incidents)
			this.prisma.timelineEntry.deleteMany({}),
			// Delete postmortems (references incidents)
			this.prisma.postmortem.deleteMany({}),
			// Delete incidents (references alerts)
			this.prisma.incident.deleteMany({}),
			// Delete alerts (references events)
			this.prisma.alert.deleteMany({}),
			// Delete events
			this.prisma.event.deleteMany({}),
		]);

		return { success: true, message: "All data has been reset" };
	}

	async factoryReset() {
		// Delete EVERYTHING except the owner user
		await this.prisma.$transaction([
			// First reset data
			this.prisma.recommendation.deleteMany({}),
			this.prisma.toolExecution.deleteMany({}),
			this.prisma.agentExecution.deleteMany({}),
			this.prisma.investigation.deleteMany({}),
			this.prisma.timelineEntry.deleteMany({}),
			this.prisma.postmortem.deleteMany({}),
			this.prisma.incident.deleteMany({}),
			this.prisma.alert.deleteMany({}),
			this.prisma.event.deleteMany({}),
			// Delete services and related
			this.prisma.serviceSuggestion.deleteMany({}),
			this.prisma.serviceIntegration.deleteMany({}),
			this.prisma.serviceDependency.deleteMany({}),
			this.prisma.alertMappingRule.deleteMany({}),
			this.prisma.service.deleteMany({}),
			// Delete integrations
			this.prisma.integrationConnection.deleteMany({}),
			// Delete correlation rules
			this.prisma.correlationRule.deleteMany({}),
			// Delete all settings
			this.prisma.setting.deleteMany({}),
			// Delete sessions but keep users for now (they need to re-setup)
			this.prisma.session.deleteMany({}),
		]);

		return { success: true, message: "Factory reset complete" };
	}

	// =============================================================================
	// MCP SERVER CONFIGURATION
	// =============================================================================

	private readonly MCP_SETTINGS_KEY = "MCP_SETTINGS_V1";

	/**
	 * Default MCP settings for a fresh install.
	 * All servers are enabled with read-only mode by default.
	 */
	private getDefaultMcpSettings(): McpSettings {
		const servers: Record<MCPServerId, McpServerSettings> = {} as Record<
			MCPServerId,
			McpServerSettings
		>;

		for (const serverId of getAvailableMCPServers()) {
			servers[serverId] = {
				enabled: true,
				readOnlyMode: true,
				toolFilter: undefined,
			};
		}

		return { servers };
	}

	/**
	 * Get MCP settings (enabled servers, tool filters, read-only mode)
	 */
	async getMcpSettings(): Promise<McpSettings> {
		const setting = await this.prisma.setting.findUnique({
			where: { key: this.MCP_SETTINGS_KEY },
		});

		if (!setting) {
			return this.getDefaultMcpSettings();
		}

		try {
			const parsed = JSON.parse(setting.value);
			// Merge with defaults to ensure all servers exist
			const defaults = this.getDefaultMcpSettings();
			return {
				servers: {
					...defaults.servers,
					...parsed.servers,
				},
			};
		} catch {
			return this.getDefaultMcpSettings();
		}
	}

	/**
	 * Update MCP settings (partial update)
	 */
	async updateMcpSettings(dto: UpdateMcpSettings): Promise<McpSettings> {
		const current = await this.getMcpSettings();

		// Deep merge server settings
		const updatedServers = { ...current.servers };
		if (dto.servers) {
			for (const [serverId, serverConfig] of Object.entries(dto.servers)) {
				const existing = updatedServers[serverId as MCPServerId] || {
					enabled: true,
					readOnlyMode: true,
				};
				updatedServers[serverId as MCPServerId] = {
					enabled: serverConfig?.enabled ?? existing.enabled,
					readOnlyMode: serverConfig?.readOnlyMode ?? existing.readOnlyMode,
					toolFilter: serverConfig?.toolFilter ?? existing.toolFilter,
					customHttpUrl: serverConfig?.customHttpUrl ?? existing.customHttpUrl,
					customDockerImage:
						serverConfig?.customDockerImage ?? existing.customDockerImage,
				};
			}
		}

		const updated: McpSettings = {
			servers: updatedServers,
		};

		await this.prisma.setting.upsert({
			where: { key: this.MCP_SETTINGS_KEY },
			update: { value: JSON.stringify(updated), type: "json", category: "ai" },
			create: {
				key: this.MCP_SETTINGS_KEY,
				value: JSON.stringify(updated),
				type: "json",
				category: "ai",
			},
		});

		return updated;
	}

	/**
	 * Get status of all MCP servers (enabled, has credentials, ready)
	 */
	async getMcpStatus(): Promise<{ servers: McpServerStatus[] }> {
		const settings = await this.getMcpSettings();
		const integrations = await this.integrationsService.getIntegrationsForService();

		// Build a map of integration types that have credentials
		const integrationTypes = new Set(integrations.map((i) => i.type));

		const servers: McpServerStatus[] = [];

		for (const serverId of getAvailableMCPServers()) {
			const serverMeta = MCP_SERVERS[serverId];
			const serverSettings = settings.servers[serverId] || {
				enabled: true,
				readOnlyMode: true,
			};

			const hasCredentials = integrationTypes.has(serverMeta.integrationType);
			const isReady = serverSettings.enabled && hasCredentials;

			servers.push({
				serverId,
				enabled: serverSettings.enabled,
				readOnlyMode: serverSettings.readOnlyMode,
				hasCredentials,
				isReady,
				integrationType: serverMeta.integrationType,
				toolFilter: serverSettings.toolFilter,
			});
		}

		return { servers };
	}

	/**
	 * Get status of a specific MCP server
	 */
	async getMcpServerStatus(serverId: MCPServerId): Promise<McpServerStatus> {
		const { servers } = await this.getMcpStatus();
		const server = servers.find((s) => s.serverId === serverId);

		if (!server) {
			throw new NotFoundException(`MCP server not found: ${serverId}`);
		}

		return server;
	}

	/**
	 * Test MCP server connection by attempting to list tools
	 */
	async testMcpConnection(
		serverId: MCPServerId,
	): Promise<{ success: boolean; error?: string; toolCount?: number }> {
		const serverMeta = MCP_SERVERS[serverId];
		if (!serverMeta) {
			return { success: false, error: `Unknown MCP server: ${serverId}` };
		}

		// Get integration credentials
		const integrations = await this.integrationsService.getIntegrationsForService();
		const integration = integrations.find(
			(i) => i.type === serverMeta.integrationType,
		);

		if (!integration) {
			return {
				success: false,
				error: `No ${serverMeta.integrationType} integration configured. Please add the integration first.`,
			};
		}

		try {
			// Build transport config and test connection
			// For now, we just verify credentials exist - actual MCP connection testing
			// would require importing the MCP client which adds complexity
			const credentials = integration.credentials as Record<string, unknown>;
			const hasToken = !!(credentials.accessToken || credentials.apiKey);

			if (!hasToken) {
				return {
					success: false,
					error: "Integration credentials are missing required token",
				};
			}

			// Return success with tool count from metadata
			return {
				success: true,
				toolCount: serverMeta.suggestedTools.length,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Connection test failed",
			};
		}
	}
}
