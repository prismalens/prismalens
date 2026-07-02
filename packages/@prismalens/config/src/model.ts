/**
 * @prismalens/config/model
 *
 * The Tier-1 model layer (ADR-0013): ONE provider resolver behind the Vercel AI
 * SDK, shared by the engine's synthesis (structured generation) and the API's
 * connection test (a ~1-token ping). No hardcoded provider URLs or auth headers —
 * the `@ai-sdk/*` packages own each provider's base URL + credentials.
 *
 * Gateway-safe (ADR-0006): `resolveModel` ALWAYS returns a provider-instance
 * model, never a bare "creator/model" string, so a call can never route through
 * the hosted Vercel AI Gateway. Secrets stay in env — the CALLER reads them and
 * passes them in; this module never touches `process.env`.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, generateText, type LanguageModel } from "ai";
import { getDefaultModel, type LLMProviderId } from "./providers/llm.js";

/** Credentials + endpoint for a model call (all injected by the caller). */
export interface ModelCredentials {
	apiKey?: string;
	/** Required for the OpenAI-compatible providers (`ollama`, `custom`). */
	baseURL?: string;
}

/**
 * Resolve a (provider, model id) + credentials into an AI SDK `LanguageModel`.
 * Named `@ai-sdk/*` providers for the clouds; `@ai-sdk/openai-compatible` for the
 * `ollama`/`custom` endpoints. The returned value is always a provider instance.
 */
export function resolveModel(
	providerId: LLMProviderId,
	model: string,
	creds: ModelCredentials = {},
): LanguageModel {
	const { apiKey, baseURL } = creds;
	switch (providerId) {
		case "anthropic":
			return createAnthropic({ apiKey, ...(baseURL ? { baseURL } : {}) })(
				model,
			);
		case "openai":
			return createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })(model);
		case "google":
			return createGoogle({ apiKey })(model);
		case "groq":
			return createGroq({ apiKey })(model);
		case "ollama":
		case "custom": {
			if (!baseURL) {
				throw new Error(
					`Provider "${providerId}" is OpenAI-compatible and requires a baseURL.`,
				);
			}
			return createOpenAICompatible({
				name: providerId,
				baseURL,
				...(apiKey ? { apiKey } : {}),
			})(model);
		}
		default: {
			const unreachable: never = providerId;
			throw new Error(`Unknown LLM provider: ${String(unreachable)}`);
		}
	}
}

/** The outcome of a connection test. */
export interface PingResult {
	success: boolean;
	error?: string;
}

/**
 * Validate that a provider + model + credential is actually callable, via a
 * ~1-token generation through {@link resolveModel} (ADR-0013: prove the model is
 * callable, not merely that a key parses). Costs one token per call.
 *
 * `model` omitted → the provider's default ({@link getDefaultModel}); returns
 * `success:false` if the provider has no default and none was given.
 */
export async function pingModel(
	providerId: LLMProviderId,
	model: string | undefined,
	creds: ModelCredentials = {},
	timeoutMs = 10_000,
): Promise<PingResult> {
	const resolvedModel = model ?? getDefaultModel(providerId);
	if (!resolvedModel) {
		return {
			success: false,
			error: `No model specified and provider "${providerId}" has no default model.`,
		};
	}
	try {
		await generateText({
			model: resolveModel(providerId, resolvedModel, creds),
			prompt: "ping",
			maxOutputTokens: 1,
			abortSignal: AbortSignal.timeout(timeoutMs),
		});
		return { success: true };
	} catch (err) {
		return { success: false, error: describePingError(err) };
	}
}

/** Turn an AI SDK / transport error into a short, user-facing connection message. */
function describePingError(err: unknown): string {
	if (APICallError.isInstance(err)) {
		const status = err.statusCode;
		if (status === 401 || status === 403)
			return "Invalid or unauthorized API key.";
		if (status === 404) return "Model or endpoint not found.";
		if (status === 429) return "Rate limited — try again shortly.";
		if (status && status >= 500) return `Provider error (${status}).`;
		return err.message || `Provider returned ${status ?? "an error"}.`;
	}
	return err instanceof Error ? err.message : "Connection failed";
}
