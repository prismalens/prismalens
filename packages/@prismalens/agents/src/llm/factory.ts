/**
 * LLM factory for creating chat models from provider configurations
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { ChatAnthropic } from "@langchain/anthropic"
import { ChatOpenAI } from "@langchain/openai"
import { ChatGroq } from "@langchain/groq"
import { ChatOllama } from "@langchain/ollama"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import type { LLMProviderConfig } from "../types/index.js"

/**
 * Create a chat model from provider configuration
 */
export function createLLM(config: LLMProviderConfig): BaseChatModel {
  switch (config.provider) {
    case "anthropic":
      return new ChatAnthropic({
        model: config.model,
        apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
        temperature: config.temperature ?? 0.2,
        maxTokens: config.maxTokens ?? 4096,
        topP: config.topP,
        topK: config.topK,
        stopSequences: config.stopSequences,
      })

    case "openai":
      return new ChatOpenAI({
        model: config.model,
        apiKey: config.apiKey || process.env.OPENAI_API_KEY,
        temperature: config.temperature ?? 0.2,
        maxTokens: config.maxTokens ?? 4096,
        topP: config.topP,
        frequencyPenalty: config.frequencyPenalty,
        presencePenalty: config.presencePenalty,
        stop: config.stopSequences,
      })

    case "groq":
      return new ChatGroq({
        model: config.model,
        apiKey: config.apiKey || process.env.GROQ_API_KEY,
        temperature: config.temperature ?? 0.2,
        maxTokens: config.maxTokens ?? 4096,
        topP: config.topP,
        frequencyPenalty: config.frequencyPenalty,
        presencePenalty: config.presencePenalty,
        stop: config.stopSequences,
      })

    case "ollama":
      return new ChatOllama({
        model: config.model,
        baseUrl: config.baseURL || process.env.OLLAMA_BASE_URL || "http://localhost:11434",
        temperature: config.temperature ?? 0.2,
        topP: config.topP,
        topK: config.topK,
        stop: config.stopSequences,
      })

    case "google":
      return new ChatGoogleGenerativeAI({
        model: config.model,
        apiKey: config.apiKey || process.env.GOOGLE_API_KEY,
        temperature: config.temperature ?? 0.2,
        maxOutputTokens: config.maxTokens ?? 4096,
        topP: config.topP,
        topK: config.topK,
        stopSequences: config.stopSequences,
      })

    case "openrouter":
      return new ChatOpenAI({
        model: config.model,
        apiKey: config.apiKey || process.env.OPENROUTER_API_KEY,
        configuration: {
          baseURL: config.baseURL || "https://openrouter.ai/api/v1",
        },
        temperature: config.temperature ?? 0.2,
        maxTokens: config.maxTokens ?? 4096,
        topP: config.topP,
        frequencyPenalty: config.frequencyPenalty,
        presencePenalty: config.presencePenalty,
        stop: config.stopSequences,
      })

    default:
      throw new Error(`Unsupported LLM provider: ${config.provider}`)
  }
}
