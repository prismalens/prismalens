// Config-driven backend selection (the opencode model). A provider id — validated against
// @prismalens/config's registry (sourced from models.dev) — resolves to a ModelBackend:
// "google" → native Gemini; everything else → the universal OpenAI-compatible backend,
// including local Ollama (`/v1`). Minimal reuse of @prismalens/config for now (provider list
// + key env var); fuller credential/encryption integration is a follow-up.

import { getApiKeyEnvVar, type LLMProviderId } from "@prismalens/config/llm";
import { createGeminiBackend } from "./backends/gemini.js";
import { createOpenAICompatBackend } from "./backends/openai-compat.js";
import type { ModelBackend } from "./types.js";

/** OpenAI-compatible base URL per provider. The config registry is LangChain-oriented and
 *  doesn't carry these; local/custom read from env. */
function openAiCompatBaseUrl(provider: LLMProviderId): string {
	switch (provider) {
		case "openai":
			return "https://api.openai.com/v1";
		case "groq":
			return "https://api.groq.com/openai/v1";
		case "ollama":
			return `${(process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/$/, "")}/v1`;
		default:
			return process.env.OPENAI_BASE_URL || process.env.PRISMALENS_LLM_BASE_URL || "";
	}
}

export interface BackendSpec {
	provider: LLMProviderId;
	model: string;
	/** Override the key (else read from the provider's env var via @prismalens/config). */
	apiKey?: string;
	/** Override the OpenAI-compatible base URL. */
	baseUrl?: string;
}

/** Resolve a provider id to a ModelBackend. */
export function createBackend(spec: BackendSpec): ModelBackend {
	const envVar = getApiKeyEnvVar(spec.provider);
	const apiKey = spec.apiKey ?? (envVar ? process.env[envVar] : undefined) ?? "";
	if (spec.provider === "google") {
		if (!apiKey) throw new Error(`Missing ${envVar || "GOOGLE_API_KEY"} for the Gemini backend.`);
		return createGeminiBackend({ apiKey, model: spec.model });
	}
	const baseUrl = spec.baseUrl ?? openAiCompatBaseUrl(spec.provider);
	if (!baseUrl) {
		throw new Error(`No base URL for provider "${spec.provider}". Set OPENAI_BASE_URL or pass baseUrl.`);
	}
	return createOpenAICompatBackend({ baseUrl, apiKey: apiKey || undefined, model: spec.model, label: spec.provider });
}
