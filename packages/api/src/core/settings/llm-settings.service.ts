import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { createLLM, type LLMProviderConfig } from '@prismalens/agents';
import {
  LLM_PROVIDERS,
  LLM_PROVIDER_IDS,
  getApiKeyEnvVar,
  getAllowedHosts,
  type LLMProviderId,
} from '@prismalens/config/llm';
import type {
  LlmSettings,
  ModelMetadata,
  ModelsListResponse,
  UpdateLlmSettings,
} from '@prismalens/contracts/schemas';
import { PrismaService } from '../prisma/prisma.service.js';
import { CredentialsService } from '../../modules/integrations/crypto/credentials.service.js';

// ── Base URL Allowlist ──────────────────────────────────────────────────────

/**
 * Hostnames blocked even for unrestricted providers (defense-in-depth).
 * Prevents SSRF to cloud metadata, link-local, and loopback ranges.
 */
const BLOCKED_HOSTNAMES = new Set([
  '169.254.169.254', // AWS/GCP/Azure metadata
  'metadata.google.internal', // GCP metadata
]);

/** Patterns that match private/internal IP ranges (blocked for unrestricted providers). */
const BLOCKED_IP_PATTERNS = [
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // 169.254.0.0/16
] as const;

/**
 * Validate a base URL against the provider's hostname allowlist.
 *
 * - Protocol must be http or https
 * - Hostname must be in the provider's allowedHosts list
 * - Unrestricted providers (allowedHosts: null) still block known-dangerous internal hosts
 *
 * @throws Error if the URL is invalid or the hostname is not allowed
 */
function validateBaseUrl(url: string, providerId: LLMProviderId): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid base URL: ${url}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Unsupported protocol: ${parsed.protocol}. Only http and https are allowed.`,
    );
  }

  const hostname = parsed.hostname;
  const allowed = getAllowedHosts(providerId);

  if (allowed === null) {
    // Unrestricted provider — still block known-dangerous internal targets
    if (BLOCKED_HOSTNAMES.has(hostname)) {
      throw new Error(
        `Base URL host "${hostname}" is blocked (internal/metadata endpoint).`,
      );
    }
    if (BLOCKED_IP_PATTERNS.some((pattern) => pattern.test(hostname))) {
      throw new Error(
        `Base URL host "${hostname}" is blocked (private IP range).`,
      );
    }
    return;
  }

  if (!allowed.includes(hostname)) {
    throw new Error(
      `Base URL host "${hostname}" is not allowed for provider "${providerId}". ` +
        `Allowed hosts: ${allowed.join(', ')}`,
    );
  }
}

/** Provider IDs that have models on models.dev (excludes ollama, custom) */
const MODELS_DEV_PROVIDERS = LLM_PROVIDER_IDS.filter(
  (id): id is Exclude<LLMProviderId, 'ollama' | 'custom'> =>
    id !== 'ollama' && id !== 'custom',
);

/** models.dev API model entry */
interface ModelsDevModel {
  id: string;
  name: string;
  family?: string;
  tool_call: boolean;
  reasoning: boolean;
  release_date?: string;
  status?: string;
  cost: { input: number; output: number };
  limit: { context: number; output: number };
  modalities: { input: string[]; output: string[] };
}

/** models.dev API provider entry */
interface ModelsDevProvider {
  id: string;
  name: string;
  models: Record<string, ModelsDevModel>;
}

@Injectable()
export class LlmSettingsService {
  private readonly logger = new Logger(LlmSettingsService.name);

  private readonly LLM_SETTINGS_KEY = 'LLM_SETTINGS';
  private readonly LLM_CREDENTIALS_KEY = 'LLM_CREDENTIALS_ENCRYPTED';

  /** In-memory cache for models.dev data */
  private modelsCache: { data: ModelMetadata[]; expiresAt: number } | null =
    null;
  private static readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => CredentialsService))
    private credentialsService: CredentialsService,
  ) {}

  private getDefaultLlmSettings(): LlmSettings {
    return {
      activeProvider: null,
      providers: {} as Record<LLMProviderId, { model: string }>,
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

      if (providerId === 'custom') {
        // Custom provider is always "ready" — user provides key per-connection
        isReady = true;
      } else if (providerId === 'ollama') {
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
      process.env.PRISMALENS_OLLAMA_BASE_URL || 'http://localhost:11434';

    try {
      validateBaseUrl(baseUrl, 'ollama');
    } catch {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: controller.signal,
        redirect: 'error',
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
    // Allowlist check: validate any base URLs before persisting
    if (dto.providers) {
      for (const [providerId, providerConfig] of Object.entries(
        dto.providers,
      )) {
        if (providerConfig?.baseUrl) {
          validateBaseUrl(providerConfig.baseUrl, providerId as LLMProviderId);
        }
      }
    }

    const current = await this.getLlmSettings();

    const updatedProviders = { ...current.providers };
    if (dto.providers) {
      for (const [providerId, providerConfig] of Object.entries(
        dto.providers,
      )) {
        const existing = updatedProviders[providerId as LLMProviderId];
        const existingModel = existing?.model ?? '';
        updatedProviders[providerId as LLMProviderId] = {
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
      update: { value: JSON.stringify(updated), type: 'json', category: 'ai' },
      create: {
        key: this.LLM_SETTINGS_KEY,
        value: JSON.stringify(updated),
        type: 'json',
        category: 'ai',
      },
    });

    return updated;
  }

  async getAvailableModels(provider?: string): Promise<ModelsListResponse> {
    const allModels = await this.fetchModelsFromRegistry();

    const filtered = provider
      ? allModels.filter((m) => m.provider === provider)
      : allModels;

    return { models: filtered };
  }

  /**
   * Fetch models from models.dev with 1-hour in-memory cache.
   * Returns empty array on network failure (graceful degradation).
   */
  private async fetchModelsFromRegistry(): Promise<ModelMetadata[]> {
    const now = Date.now();
    if (this.modelsCache && this.modelsCache.expiresAt > now) {
      return this.modelsCache.data;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch('https://models.dev/api.json', {
        signal: controller.signal,
        redirect: 'error',
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        this.logger.warn(
          `models.dev returned ${response.status}, using empty model list`,
        );
        return this.modelsCache?.data ?? [];
      }

      const data = (await response.json()) as Record<string, ModelsDevProvider>;
      const models: ModelMetadata[] = [];

      for (const providerId of MODELS_DEV_PROVIDERS) {
        const providerData = data[providerId];
        if (!providerData?.models) continue;

        for (const model of Object.values(providerData.models)) {
          // Skip deprecated models
          if (model.status === 'deprecated') continue;

          // Skip embedding models (no text generation)
          if (model.family === 'text-embedding') continue;

          models.push({
            id: model.id,
            name: model.name,
            provider: providerId,
            cost: {
              input: model.cost.input,
              output: model.cost.output,
            },
            limit: {
              context: model.limit.context,
              output: model.limit.output,
            },
            toolCall: model.tool_call,
            reasoning: model.reasoning,
            modalities: model.modalities,
            releaseDate: model.release_date,
          });
        }
      }

      // Sort by release date descending (newest first)
      models.sort((a, b) => {
        if (!a.releaseDate && !b.releaseDate) return 0;
        if (!a.releaseDate) return 1;
        if (!b.releaseDate) return -1;
        return (
          new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime()
        );
      });

      this.modelsCache = {
        data: models,
        expiresAt: now + LlmSettingsService.CACHE_TTL_MS,
      };

      this.logger.log(
        `Loaded ${models.length} models from models.dev for ${MODELS_DEV_PROVIDERS.length} providers`,
      );

      return models;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch models from models.dev: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return this.modelsCache?.data ?? [];
    }
  }

  async testLlmConnectionWithEnv(
    provider: LLMProviderId,
    model?: string,
    baseUrl?: string,
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
        // Fetch first available model from registry as fallback
        const { models } = await this.getAvailableModels(provider);
        testModel = models[0]?.id;
      }
      if (!testModel) {
        return {
          success: false,
          error: 'No model specified and none available from registry.',
        };
      }

      // Resolve base URL: explicit param > env var > provider default
      const resolvedBaseUrl =
        baseUrl ||
        (provider === 'ollama'
          ? process.env.PRISMALENS_OLLAMA_BASE_URL || 'http://localhost:11434'
          : undefined);

      // Allowlist check: validate base URL before making server-side requests
      if (resolvedBaseUrl) {
        validateBaseUrl(resolvedBaseUrl, provider);
      }

      const llmConfig: LLMProviderConfig = {
        provider: provider as LLMProviderConfig['provider'],
        model: testModel,
        ...(resolvedBaseUrl && { baseURL: resolvedBaseUrl }),
        temperature: 0,
        maxTokens: 50,
      };

      const llm = createLLM(llmConfig);
      await llm.invoke('Reply with just "OK" to confirm connection.');

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  // =========================================================================
  // LLM CREDENTIAL STORAGE + ENV BRIDGE
  // =========================================================================

  async saveLlmCredential(
    providerId: LLMProviderId,
    apiKey: string,
  ): Promise<void> {
    const existing = await this.getLlmCredentialMap(true);
    const credMap = { ...existing, [providerId]: apiKey };

    const encrypted = this.credentialsService.encryptToBase64(credMap);
    await this.prisma.setting.upsert({
      where: { key: this.LLM_CREDENTIALS_KEY },
      update: { value: encrypted },
      create: {
        key: this.LLM_CREDENTIALS_KEY,
        value: encrypted,
        type: 'encrypted',
        category: 'ai',
      },
    });

    // Safe in the API process: single-purpose, admin-only, sequential UI calls.
    // Workers fetch credentials on-demand via internal API (not from this env).
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
      const encrypted = this.credentialsService.encryptToBase64(credMap);
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
    Record<
      string,
      {
        hasDbKey: boolean;
        hasEnvKey: boolean;
        activeSource: 'db' | 'env' | 'none';
      }
    >
  > {
    const credMap = await this.getLlmCredentialMap();
    const providerIds = Object.keys(LLM_PROVIDERS) as LLMProviderId[];
    const result: Record<
      string,
      {
        hasDbKey: boolean;
        hasEnvKey: boolean;
        activeSource: 'db' | 'env' | 'none';
      }
    > = {};

    for (const id of providerIds) {
      const hasDbKey = !!credMap[id];
      const envVar = getApiKeyEnvVar(id);
      const hasEnvKey = envVar ? !!process.env[envVar] : false;

      let activeSource: 'db' | 'env' | 'none' = 'none';
      if (hasDbKey) {
        activeSource = 'db';
      } else if (hasEnvKey) {
        activeSource = 'env';
      }

      result[id] = { hasDbKey, hasEnvKey, activeSource };
    }

    return result;
  }

  private async getLlmCredentialMap(
    throwOnError = false,
  ): Promise<Record<string, string>> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: this.LLM_CREDENTIALS_KEY },
    });

    if (!setting) return {};

    try {
      return this.credentialsService.decryptFromBase64<Record<string, string>>(
        setting.value,
      );
    } catch (error) {
      this.logger.error('Failed to decrypt LLM credentials', error);
      if (throwOnError) {
        throw new Error(
          'Failed to decrypt existing LLM credentials. The encryption key may have changed.',
        );
      }
      return {};
    }
  }
}
