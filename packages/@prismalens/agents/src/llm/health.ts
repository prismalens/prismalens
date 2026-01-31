/**
 * LLM Provider Health Checks
 *
 * Performs upfront readiness checks for LLM providers before agent execution.
 * Detects connectivity issues early with clear, actionable error messages.
 */

import { Logger } from "@prismalens/logger";
import { LLMErrorCode } from "./errors.js";
import type { LLMProviderConfig } from "./factory.js";

const logger = new Logger({ context: "LLMHealth" });

// =============================================================================
// CLOUD API URLS
// =============================================================================

/**
 * Base URLs for cloud API connectivity checks.
 * We use HTTP HEAD to these URLs to verify network connectivity.
 */
const CLOUD_API_URLS: Record<string, string> = {
	anthropic: "https://api.anthropic.com",
	openai: "https://api.openai.com",
	google: "https://generativelanguage.googleapis.com",
	groq: "https://api.groq.com",
	openrouter: "https://openrouter.ai",
	nvidia: "https://integrate.api.nvidia.com",
};

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result of a provider health check.
 */
export interface HealthCheckResult {
	/** Provider name */
	provider: string;
	/** Model being checked (if applicable) */
	model?: string;
	/** Whether the provider is healthy and accessible */
	healthy: boolean;
	/** Time taken for the health check in milliseconds */
	latencyMs: number;
	/** Error details if unhealthy */
	error?: {
		code: LLMErrorCode;
		message: string;
		suggestion?: string;
	};
	/** When the check was performed */
	timestamp: Date;
}

// =============================================================================
// HEALTH CHECK FUNCTIONS
// =============================================================================

/**
 * Check if Ollama is running and accessible.
 *
 * @param baseUrl - Ollama base URL (default: http://localhost:11434)
 * @returns Health check result
 */
async function checkOllamaHealth(baseUrl: string): Promise<HealthCheckResult> {
	const start = Date.now();

	try {
		const response = await fetch(`${baseUrl}/api/version`, {
			signal: AbortSignal.timeout(5000), // 5s timeout
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		// Validate we get a JSON response
		await response.json();

		const latencyMs = Date.now() - start;
		logger.debug("Ollama health check passed", { baseUrl, latencyMs });

		return {
			provider: "ollama",
			healthy: true,
			latencyMs,
			timestamp: new Date(),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const latencyMs = Date.now() - start;

		// Detect connection refused / network errors
		const isConnectionRefused =
			message.includes("ECONNREFUSED") ||
			message.includes("fetch failed") ||
			message.includes("ENOTFOUND") ||
			message.includes("ECONNRESET");

		logger.debug("Ollama health check failed", {
			baseUrl,
			latencyMs,
			error: message,
			isConnectionRefused,
		});

		return {
			provider: "ollama",
			healthy: false,
			latencyMs,
			error: {
				code: LLMErrorCode.PROVIDER_NOT_READY,
				message: isConnectionRefused
					? `Ollama not running at ${baseUrl}`
					: `Ollama health check failed: ${message}`,
				suggestion: isConnectionRefused
					? "Start Ollama with: ollama serve"
					: undefined,
			},
			timestamp: new Date(),
		};
	}
}

/**
 * Check cloud API connectivity using HTTP HEAD.
 *
 * This only checks if the API endpoint is reachable - it does NOT validate
 * API keys. API key validation happens on the first real LLM call.
 *
 * @param provider - Provider name
 * @returns Health check result
 */
async function checkCloudAPIHealth(
	provider: string,
): Promise<HealthCheckResult> {
	const start = Date.now();
	const baseUrl = CLOUD_API_URLS[provider];

	// Unknown provider - assume healthy
	if (!baseUrl) {
		logger.debug("Unknown provider, skipping health check", { provider });
		return {
			provider,
			healthy: true,
			latencyMs: 0,
			timestamp: new Date(),
		};
	}

	try {
		const response = await fetch(baseUrl, {
			method: "HEAD",
			signal: AbortSignal.timeout(5000), // 5s timeout
		});

		// Any response (even 401/403) means the API is reachable
		const latencyMs = Date.now() - start;
		logger.debug("Cloud API health check passed", {
			provider,
			baseUrl,
			latencyMs,
			status: response.status,
		});

		return {
			provider,
			healthy: true,
			latencyMs,
			timestamp: new Date(),
		};
	} catch (error) {
		const latencyMs = Date.now() - start;
		const message = error instanceof Error ? error.message : String(error);

		logger.debug("Cloud API health check failed", {
			provider,
			baseUrl,
			latencyMs,
			error: message,
		});

		return {
			provider,
			healthy: false,
			latencyMs,
			error: {
				code: LLMErrorCode.NETWORK,
				message: `Cannot connect to ${provider} API`,
				suggestion: "Check your internet connection or provider status page",
			},
			timestamp: new Date(),
		};
	}
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Check provider health based on configuration.
 *
 * For local providers (Ollama), checks if the service is running.
 * For cloud providers, checks if the API endpoint is reachable.
 *
 * @param config - LLM provider configuration
 * @returns Health check result
 *
 * @example
 * ```typescript
 * const result = await checkProviderHealth({
 *   provider: "ollama",
 *   model: "qwen3:14b",
 *   baseUrl: "http://localhost:11434",
 * });
 *
 * if (!result.healthy) {
 *   console.error(result.error?.message);
 *   console.log("Suggestion:", result.error?.suggestion);
 * }
 * ```
 */
export async function checkProviderHealth(
	config: LLMProviderConfig,
): Promise<HealthCheckResult> {
	const { provider } = config;

	logger.debug("Checking provider health", { provider });

	switch (provider) {
		case "ollama": {
			const baseUrl =
				(config as { baseUrl?: string }).baseUrl || "http://localhost:11434";
			return checkOllamaHealth(baseUrl);
		}
		case "anthropic":
		case "openai":
		case "google":
		case "groq":
		case "openrouter":
		case "nvidia":
			return checkCloudAPIHealth(provider);
		default:
			// Unknown provider - assume healthy
			logger.debug("Unknown provider, assuming healthy", { provider });
			return {
				provider,
				healthy: true,
				latencyMs: 0,
				timestamp: new Date(),
			};
	}
}

/**
 * Check health and throw if provider is not ready.
 *
 * @param config - LLM provider configuration
 * @throws LLMError if provider is not healthy
 */
export async function checkProviderHealthOrThrow(
	config: LLMProviderConfig,
): Promise<HealthCheckResult> {
	const result = await checkProviderHealth(config);

	if (!result.healthy) {
		// Import LLMError dynamically to avoid circular dependency
		const { LLMError } = await import("./errors.js");

		const model =
			(config as { model?: string }).model ||
			(config as { modelName?: string }).modelName ||
			"unknown";

		throw new LLMError(
			result.error?.message || "Provider not ready",
			result.provider,
			model,
			result.error?.code || LLMErrorCode.PROVIDER_NOT_READY,
			true, // Retryable - user can start the provider
		);
	}

	return result;
}
