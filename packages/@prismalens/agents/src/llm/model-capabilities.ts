/**
 * Model Capabilities Validation
 *
 * Fetches model capabilities from models.dev API and validates
 * that models meet agent requirements before use.
 *
 * @see https://models.dev/api.json
 */

import { Logger } from "@prismalens/logger";
import { LLMError, LLMErrorCode } from "./errors.js";

const logger = new Logger({ context: "ModelCapabilities" });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Model information from models.dev API.
 */
export interface ModelInfo {
	id: string;
	name?: string;
	tool_call?: boolean;
	reasoning?: boolean;
	limit?: {
		context?: number;
		output?: number;
	};
	modalities?: {
		input?: string[];
		output?: string[];
	};
}

/**
 * Provider information from models.dev API.
 */
export interface ProviderInfo {
	id: string;
	name: string;
	models: Record<string, ModelInfo>;
}

/**
 * Full API response structure.
 */
export type ModelsDevResponse = Record<string, ProviderInfo>;

// =============================================================================
// CACHE
// =============================================================================

const MODELS_API_URL = "https://models.dev/api.json";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cachedModels: ModelsDevResponse | null = null;
let cacheTimestamp = 0;

// =============================================================================
// API FETCHING
// =============================================================================

/**
 * Fetch model capabilities from models.dev API with caching.
 * Falls back to cached data if fetch fails.
 */
export async function fetchModelCapabilities(): Promise<ModelsDevResponse> {
	const now = Date.now();

	// Return cached data if still fresh
	if (cachedModels && now - cacheTimestamp < CACHE_TTL_MS) {
		logger.debug("Using cached model capabilities", {
			providers: Object.keys(cachedModels).length,
			cacheAgeMs: now - cacheTimestamp,
		});
		return cachedModels;
	}

	try {
		logger.info("Fetching model capabilities from models.dev");

		const response = await fetch(MODELS_API_URL, {
			signal: AbortSignal.timeout(10000), // 10s timeout
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		cachedModels = (await response.json()) as ModelsDevResponse;
		cacheTimestamp = now;

		logger.info("Model capabilities refreshed", {
			providers: Object.keys(cachedModels).length,
		});

		return cachedModels;
	} catch (error) {
		logger.warn("Failed to fetch model capabilities, using cached or empty", {
			error: error instanceof Error ? error.message : String(error),
			hasCached: !!cachedModels,
		});

		// Return cached data even if stale, or empty object
		return cachedModels || {};
	}
}

/**
 * Clear the cached model data (for testing).
 */
export function clearModelCapabilitiesCache(): void {
	cachedModels = null;
	cacheTimestamp = 0;
}

// =============================================================================
// MODEL LOOKUP
// =============================================================================

/**
 * Provider name mapping from our config to models.dev naming.
 */
const PROVIDER_NAME_MAP: Record<string, string> = {
	anthropic: "anthropic",
	openai: "openai",
	google: "google",
	groq: "groq",
	ollama: "ollama",
	openrouter: "openrouter",
	nvidia: "nvidia",
};

/**
 * Get model info from the cached capabilities.
 * Supports both exact matches and partial matches.
 */
export function getModelInfo(
	models: ModelsDevResponse,
	provider: string,
	modelId: string,
): ModelInfo | null {
	// Map provider name
	const mappedProvider = PROVIDER_NAME_MAP[provider] ?? provider;
	const providerData = models[mappedProvider];

	if (!providerData?.models) {
		logger.debug("Provider not found in models.dev", {
			provider,
			mappedProvider,
		});
		return null;
	}

	// Try exact match first
	if (providerData.models[modelId]) {
		return providerData.models[modelId];
	}

	// Try partial match (e.g., "llama-3.3-70b" matches "llama-3.3-70b-versatile")
	for (const [id, info] of Object.entries(providerData.models)) {
		if (id.includes(modelId) || modelId.includes(id)) {
			logger.debug("Partial model match found", {
				requested: modelId,
				matched: id,
			});
			return info;
		}
	}

	logger.debug("Model not found in models.dev", { provider, modelId });
	return null;
}

// =============================================================================
// AGENT REQUIREMENTS
// =============================================================================

/**
 * Requirements for each agent type.
 * Used to validate model suitability.
 */
export interface AgentRequirements {
	/** Minimum context window needed */
	minContextWindow: number;
	/** Whether tool calling is required */
	requiresTools: boolean;
	/** Whether reasoning capability is preferred */
	requiresReasoning?: boolean;
	/** Estimated tokens used by system prompt + typical request */
	estimatedPromptTokens: number;
}

/**
 * Requirements for each agent.
 * These are conservative estimates based on typical usage.
 */
export const AGENT_REQUIREMENTS: Record<string, AgentRequirements> = {
	commander: {
		minContextWindow: 16000,
		requiresTools: true,
		requiresReasoning: true, // Commander benefits from reasoning
		estimatedPromptTokens: 8000,
	},
	gatherer: {
		minContextWindow: 8000,
		requiresTools: true,
		estimatedPromptTokens: 3000,
	},
	detective: {
		minContextWindow: 16000,
		requiresTools: true,
		requiresReasoning: true,
		estimatedPromptTokens: 5000,
	},
	surgeon: {
		minContextWindow: 16000,
		requiresTools: true,
		estimatedPromptTokens: 4000,
	},
	adversary: {
		minContextWindow: 8000,
		requiresTools: true,
		estimatedPromptTokens: 3000,
	},
};

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Result of model validation.
 */
export interface ValidationResult {
	/** Whether the model passes all requirements */
	valid: boolean;
	/** Non-blocking warnings */
	warnings: string[];
	/** Blocking errors */
	errors: string[];
	/** Model info if found */
	modelInfo?: ModelInfo;
}

/**
 * Validate that a model meets the requirements for a specific agent.
 *
 * @param provider - Provider name (anthropic, openai, etc.)
 * @param modelId - Model ID (claude-sonnet-4-20250514, etc.)
 * @param agentName - Agent name (commander, gatherer, etc.)
 * @returns Validation result with errors and warnings
 */
export async function validateModelForAgent(
	provider: string,
	modelId: string,
	agentName: string,
): Promise<ValidationResult> {
	const models = await fetchModelCapabilities();
	const modelInfo = getModelInfo(models, provider, modelId);
	const requirements = AGENT_REQUIREMENTS[agentName];

	// If we don't have requirements for this agent, allow any model
	if (!requirements) {
		logger.debug("No requirements defined for agent", { agentName });
		return {
			valid: true,
			warnings: [],
			errors: [],
			modelInfo: modelInfo || undefined,
		};
	}

	// If model not found in API, allow but warn
	if (!modelInfo) {
		return {
			valid: true, // Allow unknown models (might be new or custom)
			warnings: [
				`Unknown model ${provider}/${modelId} - cannot validate capabilities. Check https://models.dev`,
			],
			errors: [],
		};
	}

	const errors: string[] = [];
	const warnings: string[] = [];

	// Check context window
	const contextLimit = modelInfo.limit?.context ?? 0;
	if (contextLimit > 0 && contextLimit < requirements.minContextWindow) {
		errors.push(
			`Model has ${contextLimit.toLocaleString()} context window but ${agentName} needs ${requirements.minContextWindow.toLocaleString()}`,
		);
	}

	// Check if estimated tokens fit in context (warn if > 80%)
	if (
		contextLimit > 0 &&
		requirements.estimatedPromptTokens > contextLimit * 0.8
	) {
		const percentage = Math.round(
			(requirements.estimatedPromptTokens / contextLimit) * 100,
		);
		warnings.push(
			`${agentName} uses ~${requirements.estimatedPromptTokens.toLocaleString()} tokens, ` +
				`which is ${percentage}% of model's ${contextLimit.toLocaleString()} context`,
		);
	}

	// Check tools
	if (requirements.requiresTools && !modelInfo.tool_call) {
		errors.push(`Model doesn't support tool calling required by ${agentName}`);
	}

	// Check reasoning (warning only, not blocking)
	if (requirements.requiresReasoning && !modelInfo.reasoning) {
		warnings.push(
			`${agentName} works best with reasoning-capable models, but ${modelInfo.name || modelId} doesn't have reasoning`,
		);
	}

	return {
		valid: errors.length === 0,
		warnings,
		errors,
		modelInfo,
	};
}

/**
 * Validate model and throw LLMError if unsuitable.
 * Use this as a gate before creating agents.
 */
export async function validateModelOrThrow(
	provider: string,
	modelId: string,
	agentName: string,
): Promise<ValidationResult> {
	const result = await validateModelForAgent(provider, modelId, agentName);

	if (!result.valid) {
		logger.error("Model validation failed", {
			provider,
			model: modelId,
			agent: agentName,
			errors: result.errors,
		});

		throw new LLMError(
			`Model ${modelId} not suitable for ${agentName}: ${result.errors.join("; ")}`,
			provider,
			modelId,
			LLMErrorCode.MODEL_UNSUITABLE,
			false,
		);
	}

	// Log warnings if any
	if (result.warnings.length > 0) {
		logger.warn("Model validation warnings", {
			provider,
			model: modelId,
			agent: agentName,
			warnings: result.warnings,
			contextLimit: result.modelInfo?.limit?.context,
		});
	}

	return result;
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Get a summary of model capabilities for logging.
 */
export function summarizeModelCapabilities(modelInfo: ModelInfo): string {
	const parts: string[] = [];

	if (modelInfo.name) {
		parts.push(modelInfo.name);
	}

	if (modelInfo.limit?.context) {
		parts.push(`${(modelInfo.limit.context / 1000).toFixed(0)}k context`);
	}

	if (modelInfo.tool_call) {
		parts.push("tools");
	}

	if (modelInfo.reasoning) {
		parts.push("reasoning");
	}

	return parts.join(", ") || modelInfo.id;
}
