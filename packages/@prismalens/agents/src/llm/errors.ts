/**
 * LLM Error Types
 *
 * Structured error types for LLM operations with provider-aware parsing.
 * Makes errors immediately visible with proper context.
 */

import { Logger } from "@prismalens/logger";

const logger = new Logger({ context: "LLMErrors" });

// =============================================================================
// ERROR CODES
// =============================================================================

/**
 * Standardized error codes for LLM operations.
 * Each code indicates a specific failure mode with known retry semantics.
 */
export enum LLMErrorCode {
	/** Rate limit exceeded (429) - retryable with backoff */
	RATE_LIMIT = "RATE_LIMIT",
	/** Token limit exceeded for request - not retryable without reducing input */
	TOKEN_LIMIT = "TOKEN_LIMIT",
	/** Context window exceeded - not retryable without reducing input */
	CONTEXT_LIMIT = "CONTEXT_LIMIT",
	/** Model doesn't meet agent requirements - not retryable */
	MODEL_UNSUITABLE = "MODEL_UNSUITABLE",
	/** Provider not running/accessible - retryable after starting provider */
	PROVIDER_NOT_READY = "PROVIDER_NOT_READY",
	/** Authentication failed (401/403) - not retryable */
	AUTH_FAILED = "AUTH_FAILED",
	/** Provider returned an error (500s) - retryable */
	PROVIDER_ERROR = "PROVIDER_ERROR",
	/** Request timed out - retryable */
	TIMEOUT = "TIMEOUT",
	/** Network connectivity issue - retryable */
	NETWORK = "NETWORK",
	/** Unknown error - check cause */
	UNKNOWN = "UNKNOWN",
}

// =============================================================================
// STRUCTURED ERROR CLASS
// =============================================================================

/**
 * Structured error for LLM operations.
 * Includes provider context, retry information, and optional token counts.
 */
export class LLMError extends Error {
	public readonly name = "LLMError";

	constructor(
		message: string,
		public readonly provider: string,
		public readonly model: string,
		public readonly code: LLMErrorCode,
		public readonly retryable: boolean,
		public readonly retryAfterMs?: number,
		public readonly tokenInfo?: {
			requested?: number;
			limit?: number;
		},
		public readonly cause?: Error,
	) {
		super(message);

		// Maintain proper prototype chain
		Object.setPrototypeOf(this, LLMError.prototype);

		// Log error creation for visibility
		logger.debug("LLMError created", {
			code,
			provider,
			model,
			retryable,
			tokenInfo,
			message,
		});
	}

	/**
	 * Create a human-readable summary of the error.
	 */
	toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			provider: this.provider,
			model: this.model,
			retryable: this.retryable,
			retryAfterMs: this.retryAfterMs,
			tokenInfo: this.tokenInfo,
		};
	}
}

// =============================================================================
// ERROR PARSING
// =============================================================================

/**
 * Known error message patterns for each provider.
 * Used to detect specific error types from raw error messages.
 */
const ERROR_PATTERNS = {
	// Rate limit patterns
	rateLimit: [
		/rate limit/i,
		/too many requests/i,
		/quota exceeded/i,
		/requests per minute/i,
		/tokens per minute/i,
		/RPM limit/i,
		/TPM limit/i,
	],
	// Token/context limit patterns
	tokenLimit: [
		/token limit/i,
		/context length/i,
		/maximum context/i,
		/too (many|long)/i,
		/Limit (\d+), Requested (\d+)/i,
		/exceeds? the model's/i,
		/input.*too long/i,
	],
	// Auth patterns
	authFailed: [
		/invalid.*api[_\s]?key/i,
		/authentication/i,
		/unauthorized/i,
		/forbidden/i,
		/permission denied/i,
		/invalid credentials/i,
	],
	// Timeout patterns
	timeout: [/timeout/i, /timed out/i, /deadline exceeded/i, /ETIMEDOUT/i],
	// Network patterns
	network: [
		/ECONNREFUSED/i,
		/ENOTFOUND/i,
		/network/i,
		/connection refused/i,
		/socket hang up/i,
		/ECONNRESET/i,
	],
};

/**
 * Extract token information from Groq-style error messages.
 * Example: "Limit 12000, Requested 13060 tokens"
 */
function extractGroqTokenInfo(
	message: string,
): { requested?: number; limit?: number } | undefined {
	const match = message.match(/Limit (\d+),?\s*Requested (\d+)/i);
	if (match) {
		return {
			limit: Number.parseInt(match[1], 10),
			requested: Number.parseInt(match[2], 10),
		};
	}
	return undefined;
}

/**
 * Extract retry-after from error or response headers.
 */
function extractRetryAfter(error: unknown): number | undefined {
	// Check for Retry-After header in various formats
	const anyError = error as Record<string, unknown>;

	// Standard retry-after (seconds)
	if (
		typeof anyError.retryAfter === "number" ||
		typeof anyError.retryAfter === "string"
	) {
		const seconds = Number(anyError.retryAfter);
		return Number.isNaN(seconds) ? undefined : seconds * 1000;
	}

	// Check headers
	const headers = anyError.headers as Record<string, string> | undefined;
	if (headers?.["retry-after"]) {
		const seconds = Number(headers["retry-after"]);
		return Number.isNaN(seconds) ? undefined : seconds * 1000;
	}

	// Check response.headers
	const response = anyError.response as Record<string, unknown> | undefined;
	const responseHeaders = response?.headers as
		| Record<string, string>
		| undefined;
	if (responseHeaders?.["retry-after"]) {
		const seconds = Number(responseHeaders["retry-after"]);
		return Number.isNaN(seconds) ? undefined : seconds * 1000;
	}

	return undefined;
}

/**
 * Get HTTP status code from error if available.
 */
function getStatusCode(error: unknown): number | undefined {
	const anyError = error as Record<string, unknown>;

	// Direct status
	if (typeof anyError.status === "number") {
		return anyError.status;
	}
	if (typeof anyError.statusCode === "number") {
		return anyError.statusCode;
	}

	// Response status
	const response = anyError.response as Record<string, unknown> | undefined;
	if (typeof response?.status === "number") {
		return response.status;
	}

	return undefined;
}

/**
 * Detect error code from error message and status.
 */
function detectErrorCode(
	message: string,
	statusCode?: number,
): { code: LLMErrorCode; retryable: boolean } {
	// Check status codes first (more reliable)
	if (statusCode !== undefined) {
		if (statusCode === 429) {
			return { code: LLMErrorCode.RATE_LIMIT, retryable: true };
		}
		if (statusCode === 401 || statusCode === 403) {
			return { code: LLMErrorCode.AUTH_FAILED, retryable: false };
		}
		if (statusCode === 413) {
			// Request entity too large - often token limit
			return { code: LLMErrorCode.TOKEN_LIMIT, retryable: false };
		}
		if (statusCode >= 500 && statusCode < 600) {
			return { code: LLMErrorCode.PROVIDER_ERROR, retryable: true };
		}
	}

	// Fall back to message pattern matching
	for (const pattern of ERROR_PATTERNS.rateLimit) {
		if (pattern.test(message)) {
			return { code: LLMErrorCode.RATE_LIMIT, retryable: true };
		}
	}

	for (const pattern of ERROR_PATTERNS.tokenLimit) {
		if (pattern.test(message)) {
			return { code: LLMErrorCode.TOKEN_LIMIT, retryable: false };
		}
	}

	for (const pattern of ERROR_PATTERNS.authFailed) {
		if (pattern.test(message)) {
			return { code: LLMErrorCode.AUTH_FAILED, retryable: false };
		}
	}

	for (const pattern of ERROR_PATTERNS.timeout) {
		if (pattern.test(message)) {
			return { code: LLMErrorCode.TIMEOUT, retryable: true };
		}
	}

	for (const pattern of ERROR_PATTERNS.network) {
		if (pattern.test(message)) {
			return { code: LLMErrorCode.NETWORK, retryable: true };
		}
	}

	// Default to unknown
	return { code: LLMErrorCode.UNKNOWN, retryable: false };
}

/**
 * Parse any error into a structured LLMError.
 *
 * This function handles errors from any LLM provider and extracts:
 * - Error code (rate limit, token limit, auth, etc.)
 * - Whether it's retryable
 * - Token information (for limit errors)
 * - Retry-after timing
 *
 * @param error - The raw error from LLM provider
 * @param provider - Provider name (for context in logs)
 * @param model - Model name (for context in logs)
 * @returns Structured LLMError
 */
export function parseLLMError(
	error: unknown,
	provider: string,
	model: string,
): LLMError {
	// Already an LLMError - return as-is
	if (error instanceof LLMError) {
		return error;
	}

	// Extract message
	let message = "Unknown LLM error";
	if (error instanceof Error) {
		message = error.message;
	} else if (typeof error === "string") {
		message = error;
	} else if (
		typeof error === "object" &&
		error !== null &&
		"message" in error
	) {
		message = String((error as { message: unknown }).message);
	}

	// Get status code and detect error type
	const statusCode = getStatusCode(error);
	const { code, retryable } = detectErrorCode(message, statusCode);

	// Extract additional context
	const retryAfterMs = extractRetryAfter(error);
	const tokenInfo =
		code === LLMErrorCode.TOKEN_LIMIT
			? extractGroqTokenInfo(message)
			: undefined;

	// Create enhanced message
	let enhancedMessage = message;
	if (tokenInfo) {
		enhancedMessage = `Token limit exceeded: ${tokenInfo.requested?.toLocaleString() ?? "?"} requested, ${tokenInfo.limit?.toLocaleString() ?? "?"} limit. ${message}`;
	}

	return new LLMError(
		enhancedMessage,
		provider,
		model,
		code,
		retryable,
		retryAfterMs,
		tokenInfo,
		error instanceof Error ? error : undefined,
	);
}

// =============================================================================
// ERROR DISPLAY HELPERS
// =============================================================================

/**
 * Format an LLMError for console/log output.
 * Provides clear, actionable error messages.
 */
export function formatLLMError(error: LLMError): string {
	const parts: string[] = [];

	// Header with code
	parts.push(`[${error.code}] ${error.message}`);

	// Provider/model context
	parts.push(`  Provider: ${error.provider}, Model: ${error.model}`);

	// Token info if available
	if (error.tokenInfo) {
		parts.push(
			`  Tokens: ${error.tokenInfo.requested?.toLocaleString() ?? "?"} / ${error.tokenInfo.limit?.toLocaleString() ?? "?"} limit`,
		);
	}

	// Retry info
	if (error.retryable) {
		if (error.retryAfterMs) {
			parts.push(`  Retryable: Yes (after ${error.retryAfterMs}ms)`);
		} else {
			parts.push("  Retryable: Yes (with exponential backoff)");
		}
	} else {
		parts.push("  Retryable: No");
	}

	return parts.join("\n");
}

/**
 * Check if an error is an LLMError with a specific code.
 */
export function isLLMError(
	error: unknown,
	code?: LLMErrorCode,
): error is LLMError {
	if (!(error instanceof LLMError)) {
		return false;
	}
	if (code !== undefined) {
		return error.code === code;
	}
	return true;
}
