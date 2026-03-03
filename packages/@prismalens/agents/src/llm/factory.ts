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

import { getGraphConfig } from "../config/env.js"

// ── Discriminated Union Config ──────────────────────────────────────

export type AnthropicProviderConfig = { provider: "anthropic" } & ChatAnthropicInput
export type OpenAIProviderConfig = { provider: "openai"; baseURL?: string } & ChatOpenAIFields
export type GoogleProviderConfig = { provider: "google" } & GoogleGenerativeAIChatInput
export type GroqProviderConfig = { provider: "groq" } & ChatGroqInput
export type OllamaProviderConfig = { provider: "ollama" } & ChatOllamaInput

export type LLMProviderConfig =
  | AnthropicProviderConfig
  | OpenAIProviderConfig
  | GoogleProviderConfig
  | GroqProviderConfig
  | OllamaProviderConfig

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

    case "openai": {
      // ChatOpenAI expects baseURL inside `configuration`, not as a top-level field.
      // Merge it into configuration for OpenAI-compatible providers (e.g. NVIDIA NIM).
      const { provider: _, configuration: existingConfig, baseURL, ...openAIFields } = config
      const configuration = baseURL
        ? { ...existingConfig, baseURL }
        : existingConfig
      return new ChatOpenAI({
        ...openAIFields,
        ...(configuration && { configuration }),
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
