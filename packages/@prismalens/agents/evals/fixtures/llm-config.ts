/**
 * LLM Configuration for Evaluations
 *
 * Reads from PRISMALENS_* env vars (same as production).
 * Supports dynamic provider selection and per-agent overrides.
 *
 * REQUIRED Environment Variables:
 * - PRISMALENS_LLM_PROVIDER: ollama | groq | anthropic | openai | google | openrouter | nvidia
 * - PRISMALENS_LLM_MODEL: Model name (no defaults, must be set explicitly)
 *
 * Optional:
 * - PRISMALENS_OLLAMA_BASE_URL: Ollama URL (when using ollama provider)
 * - PRISMALENS_{AGENT}_PROVIDER: Per-agent provider override
 * - PRISMALENS_{AGENT}_MODEL: Per-agent model override
 */

import type {
	AgentLLMOverride,
	AgentName,
	LLMConfigWithOverrides,
	LLMProviderConfig,
} from "../../src/llm/factory.js";
import { wrapConfig } from "../../src/llm/factory.js";

// =============================================================================
// PROVIDER TYPES
// =============================================================================

type ProviderType =
	| "ollama"
	| "anthropic"
	| "openai"
	| "google"
	| "groq"
	| "openrouter"
	| "nvidia";

const VALID_PROVIDERS: ProviderType[] = [
	"ollama",
	"anthropic",
	"openai",
	"google",
	"groq",
	"openrouter",
	"nvidia",
];

// =============================================================================
// PROVIDER & MODEL RESOLUTION
// =============================================================================

/**
 * Get the LLM provider from environment.
 * Throws if PRISMALENS_LLM_PROVIDER is not set.
 */
function getProvider(): ProviderType {
	const provider = process.env.PRISMALENS_LLM_PROVIDER;

	if (!provider) {
		throw new Error(
			"PRISMALENS_LLM_PROVIDER is required. Set it in .env or environment. " +
				`Valid providers: ${VALID_PROVIDERS.join(", ")}`,
		);
	}

	if (!VALID_PROVIDERS.includes(provider as ProviderType)) {
		throw new Error(
			`Unsupported provider: ${provider}. Valid providers: ${VALID_PROVIDERS.join(", ")}`,
		);
	}

	return provider as ProviderType;
}

/**
 * Get the model from environment.
 * Throws if PRISMALENS_LLM_MODEL is not set.
 */
function getModel(): string {
	const model = process.env.PRISMALENS_LLM_MODEL;

	if (!model) {
		throw new Error(
			"PRISMALENS_LLM_MODEL is required. Set it in .env or environment.",
		);
	}

	return model;
}

// =============================================================================
// CONFIG BUILDERS (per provider)
// =============================================================================

function buildOllamaConfig(model: string): LLMProviderConfig {
	return {
		provider: "ollama",
		model,
		baseUrl:
			process.env.PRISMALENS_OLLAMA_BASE_URL || "http://localhost:11434",
		numCtx: 32768, // Hardcoded default (matches factory.ts examples)
		// numGpu: undefined means auto-detect
	};
}

function buildGroqConfig(model: string): LLMProviderConfig {
	return {
		provider: "groq",
		model,
	};
}

function buildAnthropicConfig(model: string): LLMProviderConfig {
	return {
		provider: "anthropic",
		model,
	};
}

function buildOpenAIConfig(model: string): LLMProviderConfig {
	return {
		provider: "openai",
		model,
	};
}

function buildGoogleConfig(model: string): LLMProviderConfig {
	return {
		provider: "google",
		model,
	};
}

function buildOpenRouterConfig(model: string): LLMProviderConfig {
	return {
		provider: "openrouter",
		model,
	};
}

function buildNvidiaConfig(model: string): LLMProviderConfig {
	return {
		provider: "nvidia",
		model,
		apiKey: process.env.NVIDIA_API_KEY,
	};
}

/**
 * Build provider config based on provider type.
 */
function buildProviderConfig(
	provider: ProviderType,
	model: string,
): LLMProviderConfig {
	switch (provider) {
		case "ollama":
			return buildOllamaConfig(model);
		case "groq":
			return buildGroqConfig(model);
		case "anthropic":
			return buildAnthropicConfig(model);
		case "openai":
			return buildOpenAIConfig(model);
		case "google":
			return buildGoogleConfig(model);
		case "openrouter":
			return buildOpenRouterConfig(model);
		case "nvidia":
			return buildNvidiaConfig(model);
		default: {
			const exhaustiveCheck: never = provider;
			throw new Error(`Unhandled provider: ${exhaustiveCheck}`);
		}
	}
}

// =============================================================================
// PER-AGENT OVERRIDE HELPERS
// =============================================================================

const AGENTS = [
	"commander",
	"gatherer",
	"detective",
	"surgeon",
	"adversary",
] as const;

/**
 * Build per-agent overrides from environment variables.
 * Reads PRISMALENS_{AGENT}_PROVIDER and PRISMALENS_{AGENT}_MODEL.
 *
 * @example
 * ```bash
 * PRISMALENS_COMMANDER_PROVIDER=groq
 * PRISMALENS_COMMANDER_MODEL=llama-3.3-70b-versatile
 * PRISMALENS_DETECTIVE_PROVIDER=ollama
 * PRISMALENS_DETECTIVE_MODEL=kimi-k2.5:cloud
 * ```
 */
function buildAgentOverridesFromEnv(): Partial<
	Record<AgentName, AgentLLMOverride>
> {
	const overrides: Partial<Record<AgentName, AgentLLMOverride>> = {};

	for (const agent of AGENTS) {
		const envPrefix = `PRISMALENS_${agent.toUpperCase()}`;
		const provider = process.env[`${envPrefix}_PROVIDER`];
		const model = process.env[`${envPrefix}_MODEL`];

		if (provider || model) {
			const override: AgentLLMOverride = {};
			if (provider) {
				(override as Record<string, unknown>).provider = provider;
			}
			if (model) {
				override.model = model;
			}
			overrides[agent] = override;
		}
	}

	return overrides;
}

// =============================================================================
// MAIN EXPORTS
// =============================================================================

/**
 * Get the LLM config for testing/evals.
 * Reads from PRISMALENS_LLM_PROVIDER and PRISMALENS_LLM_MODEL.
 * Throws if either is not set.
 */
export function getTestLLMConfig(): LLMProviderConfig {
	const provider = getProvider();
	const model = getModel();
	return buildProviderConfig(provider, model);
}

/**
 * Get the LLM config for the judge model (used in LLM-as-Judge evaluations).
 *
 * Resolution order:
 * 1. TEST_JUDGE_PROVIDER / TEST_JUDGE_MODEL (dedicated judge config)
 * 2. PRISMALENS_LLM_PROVIDER / PRISMALENS_LLM_MODEL (fallback to base config)
 * 3. Defaults to openai / gpt-4o-mini (cost-effective judge)
 *
 * Using a different model for judging helps avoid self-judging bias where
 * the same model evaluates its own outputs.
 *
 * @example
 * ```bash
 * # Dedicated judge model (recommended)
 * TEST_JUDGE_PROVIDER=openai
 * TEST_JUDGE_MODEL=gpt-4o-mini
 *
 * # Or fallback to base config
 * PRISMALENS_LLM_PROVIDER=anthropic
 * PRISMALENS_LLM_MODEL=claude-sonnet-4-20250514
 * ```
 */
export function getJudgeLLMConfig(): LLMProviderConfig {
	const provider =
		(process.env.TEST_JUDGE_PROVIDER as ProviderType) ||
		(process.env.PRISMALENS_LLM_PROVIDER as ProviderType) ||
		"openai";
	const model =
		process.env.TEST_JUDGE_MODEL ||
		process.env.PRISMALENS_LLM_MODEL ||
		"gpt-4o-mini";

	// Validate provider
	if (!VALID_PROVIDERS.includes(provider)) {
		throw new Error(
			`Invalid TEST_JUDGE_PROVIDER: ${provider}. Valid providers: ${VALID_PROVIDERS.join(", ")}`,
		);
	}

	return buildProviderConfig(provider, model);
}

/**
 * Check if LLM-as-Judge evaluation is enabled.
 * Reads TEST_USE_LLM_JUDGE env var (default: false).
 */
export function isLLMJudgeEnabled(): boolean {
	const value = process.env.TEST_USE_LLM_JUDGE;
	return value === "true" || value === "1";
}

/**
 * Get LLM config wrapped in LLMConfigWithOverrides format.
 * Reads per-agent overrides from PRISMALENS_{AGENT}_PROVIDER and PRISMALENS_{AGENT}_MODEL env vars.
 * Use this when working with Commander and SubAgents.
 */
export function getTestLLMConfigWithOverrides(): LLMConfigWithOverrides {
	const agentOverrides = buildAgentOverridesFromEnv();
	const hasOverrides = Object.keys(agentOverrides).length > 0;

	return {
		base: getTestLLMConfig(),
		...(hasOverrides && { agentOverrides }),
	};
}

/**
 * Get fast LLM config wrapped in LLMConfigWithOverrides format.
 * Does NOT include per-agent env var overrides (for fast isolated tests).
 */
export function getFastTestLLMConfigWithOverrides(): LLMConfigWithOverrides {
	return wrapConfig(getTestLLMConfig());
}

// =============================================================================
// DEBUGGING
// =============================================================================

/**
 * Log current LLM configuration for debugging.
 */
export function logLLMConfig(): void {
	const provider = getProvider();
	const model = getModel();
	const agentOverrides = buildAgentOverridesFromEnv();

	console.log(`LLM Config: provider=${provider}, model=${model}`);
	if (provider === "ollama") {
		console.log(
			`  Ollama URL: ${process.env.PRISMALENS_OLLAMA_BASE_URL || "http://localhost:11434"}`,
		);
	}
	if (Object.keys(agentOverrides).length > 0) {
		console.log("  Agent overrides:", JSON.stringify(agentOverrides));
	}
}
