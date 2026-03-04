/**
 * LLM factory — type-safe discriminated union configs + per-agent overrides.
 *
 * Each provider variant carries LangChain's native input type, enabling
 * cast-free spread into the constructor. Exhaustive switch ensures
 * compile-time failure when a new provider is added to the union.
 */

import { ChatAnthropic, type ChatAnthropicInput } from "@langchain/anthropic"
import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { ChatGoogleGenerativeAI, type GoogleGenerativeAIChatInput } from "@langchain/google-genai"
import { ChatGroq, type ChatGroqInput } from "@langchain/groq"
import { ChatOllama, type ChatOllamaInput } from "@langchain/ollama"
import { ChatOpenAI, type ChatOpenAIFields } from "@langchain/openai"
import type { LLMProviderId } from "@prismalens/config/llm"

import { getGraphConfig } from "../config/env.js"

// ── Discriminated Union Config ──────────────────────────────────────
// Provider IDs are derived from @prismalens/config — adding a provider
// there without handling it here will produce a compile-time error.

type AnthropicProviderConfig = { provider: Extract<LLMProviderId, "anthropic"> } & ChatAnthropicInput
type OpenAIProviderConfig = { provider: Extract<LLMProviderId, "openai">; baseURL?: string } & ChatOpenAIFields
type GoogleProviderConfig = { provider: Extract<LLMProviderId, "google"> } & GoogleGenerativeAIChatInput
type GroqProviderConfig = { provider: Extract<LLMProviderId, "groq"> } & ChatGroqInput
type OllamaProviderConfig = { provider: Extract<LLMProviderId, "ollama"> } & ChatOllamaInput
type CustomProviderConfig = { provider: Extract<LLMProviderId, "custom">; baseURL?: string } & ChatOpenAIFields

export type LLMProviderConfig =
  | AnthropicProviderConfig
  | OpenAIProviderConfig
  | GoogleProviderConfig
  | GroqProviderConfig
  | OllamaProviderConfig
  | CustomProviderConfig

// ── Per-Agent Override ──────────────────────────────────────────────

/** Minimal override fields for per-agent LLM tuning (no provider switching). */
export interface AgentLLMOverride {
  model?: string
  temperature?: number
}

/**
 * Resolve the LLM for a specific agent, applying per-agent overrides.
 *
 * Only model and temperature can be overridden per-agent. Provider switching
 * is intentionally not supported (would require different API keys).
 */
export function resolveAgentLLM(
  baseConfig: LLMProviderConfig,
  agentOverride?: AgentLLMOverride,
): BaseChatModel {
  if (!agentOverride) return createLLM(baseConfig)

  const merged = {
    ...baseConfig,
    ...(agentOverride.model && { model: agentOverride.model }),
    ...(agentOverride.temperature != null && { temperature: agentOverride.temperature }),
  }
  return createLLM(merged as LLMProviderConfig)
}

// ── Factory ─────────────────────────────────────────────────────────

/**
 * Create a chat model from a discriminated provider config.
 *
 * - Defaults (temperature, maxTokens, maxRetries) are sourced from env via getGraphConfig()
 * - API keys are resolved from process.env (loaded from DB or Docker secrets at startup)
 * - Exhaustive switch ensures compile-time failure for unhandled providers
 */
export function createLLM(config: LLMProviderConfig): BaseChatModel {
  const cfg = getGraphConfig()
  const maxRetries = cfg.PRISMALENS_LLM_MAX_RETRIES
  const defaultTemp = cfg.PRISMALENS_LLM_TEMPERATURE
  const defaultMaxTokens = cfg.PRISMALENS_LLM_MAX_TOKENS

  switch (config.provider) {
    case "anthropic": {
      const { provider: _, ...rest } = config
      return new ChatAnthropic({
        ...rest,
        temperature: rest.temperature ?? defaultTemp,
        maxTokens: rest.maxTokens ?? defaultMaxTokens,
        maxRetries,
      })
    }

    case "custom":
    case "openai": {
      // ChatOpenAI expects baseURL inside `configuration`, not as a top-level field.
      // Merge it into configuration for OpenAI-compatible providers (e.g. custom endpoints).
      const { provider: p, configuration: existingConfig, baseURL, ...openAIFields } = config
      const configuration = baseURL
        ? { ...existingConfig, baseURL }
        : existingConfig
      return new ChatOpenAI({
        ...openAIFields,
        ...(configuration && { configuration }),
        // Custom provider stores key in CUSTOM_LLM_API_KEY, not OPENAI_API_KEY
        ...(p === "custom" && process.env.CUSTOM_LLM_API_KEY
          ? { apiKey: process.env.CUSTOM_LLM_API_KEY }
          : {}),
        temperature: openAIFields.temperature ?? defaultTemp,
        maxTokens: openAIFields.maxTokens ?? defaultMaxTokens,
        maxRetries,
      })
    }

    case "google": {
      const { provider: _, ...rest } = config
      return new ChatGoogleGenerativeAI({
        ...rest,
        temperature: rest.temperature ?? defaultTemp,
        maxOutputTokens: rest.maxOutputTokens ?? defaultMaxTokens,
        maxRetries,
      })
    }

    case "groq": {
      const { provider: _, ...rest } = config
      return new ChatGroq({
        ...rest,
        temperature: rest.temperature ?? defaultTemp,
        maxTokens: rest.maxTokens ?? defaultMaxTokens,
        maxRetries,
      })
    }

    case "ollama": {
      const { provider: _, ...rest } = config
      return new ChatOllama({
        ...rest,
        temperature: rest.temperature ?? defaultTemp,
      })
    }

    default: {
      const _exhaustive: never = config
      throw new Error(`Unsupported LLM provider: ${(_exhaustive as LLMProviderConfig).provider}`)
    }
  }
}
