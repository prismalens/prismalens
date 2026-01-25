import { Logger } from "@prismalens/logger";

// =============================================================================
// RATE LIMITER
// =============================================================================
// Handles API rate limits with exponential backoff and agent warnings.
// Used to wrap MCP tool calls for external services like GitHub and Render.
// =============================================================================

const logger = new Logger({ context: "RateLimiter" });

/**
 * Rate limit state tracked from API response headers.
 */
export interface RateLimitState {
	/** Maximum requests allowed per period (X-RateLimit-Limit) */
	limit: number;

	/** Remaining requests in current period (X-RateLimit-Remaining) */
	remaining: number;

	/** When the rate limit resets (X-RateLimit-Reset) */
	resetAt: Date;

	/** When this state was last updated */
	lastUpdated: Date;
}

/**
 * Configuration for rate limiting a specific service.
 */
export interface RateLimitConfig {
	/** Service identifier */
	serviceId: string;

	/** Maximum retry attempts on rate limit errors */
	maxRetries?: number;

	/** Base delay in milliseconds for exponential backoff */
	baseDelayMs?: number;

	/** Warn agent when remaining requests fall below this threshold */
	warningThreshold?: number;

	/** Known rate limits for this service */
	knownLimits?: {
		requestsPerHour?: number;
		requestsPerMinute?: number;
	};
}

/**
 * Default rate limit configurations by service.
 */
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
	github: {
		serviceId: "github",
		maxRetries: 3,
		baseDelayMs: 1000,
		warningThreshold: 100,
		knownLimits: {
			requestsPerHour: 5000, // Authenticated REST API
		},
	},
	"github-search": {
		serviceId: "github-search",
		maxRetries: 3,
		baseDelayMs: 2000, // Search API is more restrictive
		warningThreshold: 10,
		knownLimits: {
			requestsPerMinute: 30, // Authenticated Search API
		},
	},
	render: {
		serviceId: "render",
		maxRetries: 3,
		baseDelayMs: 1000,
		warningThreshold: 50,
		knownLimits: {
			requestsPerHour: 1000,
		},
	},
};

/**
 * Result of a rate-limited execution.
 */
export interface RateLimitedResult<T> {
	/** The actual result from the execution */
	result: T;

	/** Warning message if rate limit is low */
	warning?: string;

	/** Current rate limit state */
	state?: RateLimitState;
}

/**
 * Error indicating a rate limit has been hit.
 */
export class RateLimitError extends Error {
	constructor(
		public readonly serviceId: string,
		public readonly retryAfterMs?: number,
		public readonly state?: RateLimitState,
	) {
		super(
			`Rate limit exceeded for ${serviceId}${retryAfterMs ? `. Retry after ${retryAfterMs}ms` : ""}`,
		);
		this.name = "RateLimitError";
	}
}

/**
 * Rate limiter with exponential backoff and state tracking.
 */
export class RateLimiter {
	private state: Map<string, RateLimitState> = new Map();
	private configs: Map<string, RateLimitConfig> = new Map();

	constructor(configs?: RateLimitConfig[]) {
		// Initialize with default configs
		for (const config of Object.values(DEFAULT_RATE_LIMITS)) {
			this.configs.set(config.serviceId, config);
		}

		// Override with provided configs
		if (configs) {
			for (const config of configs) {
				this.configs.set(config.serviceId, {
					...this.configs.get(config.serviceId),
					...config,
				});
			}
		}
	}

	/**
	 * Execute a function with rate limit handling.
	 * Implements exponential backoff on rate limit errors.
	 */
	async executeWithRateLimit<T>(
		serviceId: string,
		execute: () => Promise<T>,
		options?: Partial<RateLimitConfig>,
	): Promise<RateLimitedResult<T>> {
		const config = this.getConfig(serviceId, options);

		// Check if we should wait before executing
		await this.waitIfNeeded(serviceId);

		let lastError: Error | null = null;
		const maxRetries = config.maxRetries ?? 3;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				const result = await execute();

				// Return result with any rate limit warning
				const warning = this.getRateLimitWarning(serviceId);
				return {
					result,
					warning: warning ?? undefined,
					state: this.state.get(serviceId),
				};
			} catch (error) {
				if (this.isRateLimitError(error)) {
					lastError = error as Error;

					if (attempt < maxRetries) {
						const delay = this.calculateBackoff(
							attempt,
							config.baseDelayMs ?? 1000,
						);
						logger.warn(
							`Rate limit hit for ${serviceId}, attempt ${attempt + 1}/${maxRetries + 1}. Waiting ${delay}ms`,
						);
						await this.sleep(delay);
					}
				} else {
					throw error;
				}
			}
		}

		// All retries exhausted
		throw (
			lastError ||
			new RateLimitError(serviceId, undefined, this.state.get(serviceId))
		);
	}

	/**
	 * Update rate limit state from API response headers.
	 */
	updateState(
		serviceId: string,
		headers: {
			"x-ratelimit-limit"?: string;
			"x-ratelimit-remaining"?: string;
			"x-ratelimit-reset"?: string;
			"retry-after"?: string;
		},
	): void {
		const limit = headers["x-ratelimit-limit"];
		const remaining = headers["x-ratelimit-remaining"];
		const reset = headers["x-ratelimit-reset"];

		if (limit || remaining || reset) {
			const state: RateLimitState = {
				limit: limit ? parseInt(limit, 10) : this.state.get(serviceId)?.limit ?? 0,
				remaining: remaining
					? parseInt(remaining, 10)
					: this.state.get(serviceId)?.remaining ?? 0,
				resetAt: reset
					? new Date(parseInt(reset, 10) * 1000)
					: this.state.get(serviceId)?.resetAt ?? new Date(),
				lastUpdated: new Date(),
			};

			this.state.set(serviceId, state);

			logger.debug(`Updated rate limit state for ${serviceId}`, {
				limit: state.limit,
				remaining: state.remaining,
				resetAt: state.resetAt.toISOString(),
			});
		}
	}

	/**
	 * Update rate limit state from MCP result metadata.
	 * MCP servers may return rate limit info in various formats.
	 */
	updateStateFromMCPResult(
		serviceId: string,
		result: unknown,
	): void {
		// MCP results may contain rate limit info in metadata
		if (typeof result === "object" && result !== null) {
			const obj = result as Record<string, unknown>;

			// Check for rate limit metadata in common locations
			const metadata = obj._metadata || obj.metadata || obj;

			if (typeof metadata === "object" && metadata !== null) {
				const meta = metadata as Record<string, unknown>;
				const headers: Record<string, string> = {};

				// Extract rate limit headers from metadata
				if (meta.rateLimit && typeof meta.rateLimit === "object") {
					const rl = meta.rateLimit as Record<string, unknown>;
					if (rl.limit) headers["x-ratelimit-limit"] = String(rl.limit);
					if (rl.remaining) headers["x-ratelimit-remaining"] = String(rl.remaining);
					if (rl.reset) headers["x-ratelimit-reset"] = String(rl.reset);
				}

				if (Object.keys(headers).length > 0) {
					this.updateState(serviceId, headers);
				}
			}
		}
	}

	/**
	 * Get a warning message if rate limit is approaching.
	 */
	getRateLimitWarning(serviceId: string): string | null {
		const state = this.state.get(serviceId);
		const config = this.configs.get(serviceId);

		if (!state) return null;

		const threshold = config?.warningThreshold ?? 100;

		if (state.remaining <= threshold) {
			const resetIn = Math.max(
				0,
				Math.round((state.resetAt.getTime() - Date.now()) / 60000),
			);

			return `Warning: Only ${state.remaining} ${serviceId} API calls remaining. Resets in ${resetIn} minutes. Consider using local repo tools for bulk operations.`;
		}

		return null;
	}

	/**
	 * Get current rate limit state for a service.
	 */
	getState(serviceId: string): RateLimitState | undefined {
		return this.state.get(serviceId);
	}

	/**
	 * Check if we should wait before making a request.
	 */
	private async waitIfNeeded(serviceId: string): Promise<void> {
		const state = this.state.get(serviceId);

		if (state && state.remaining <= 0) {
			const waitMs = Math.max(0, state.resetAt.getTime() - Date.now());

			if (waitMs > 0 && waitMs < 60000) {
				// Only wait if less than 1 minute
				logger.info(
					`Rate limit exhausted for ${serviceId}. Waiting ${waitMs}ms until reset.`,
				);
				await this.sleep(waitMs);
			} else if (waitMs >= 60000) {
				throw new RateLimitError(serviceId, waitMs, state);
			}
		}
	}

	/**
	 * Calculate exponential backoff delay.
	 * Includes jitter to prevent thundering herd.
	 */
	private calculateBackoff(attempt: number, baseDelay: number): number {
		const exponentialDelay = baseDelay * Math.pow(2, attempt);
		const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
		return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
	}

	/**
	 * Check if an error is a rate limit error.
	 */
	private isRateLimitError(error: unknown): boolean {
		if (error instanceof RateLimitError) return true;

		if (error instanceof Error) {
			const message = error.message.toLowerCase();
			if (
				message.includes("rate limit") ||
				message.includes("too many requests") ||
				message.includes("429")
			) {
				return true;
			}

			// Check for axios/fetch status codes
			const anyError = error as unknown as Record<string, unknown>;
			if (anyError.response && typeof anyError.response === "object") {
				const response = anyError.response as Record<string, unknown>;
				if (response.status === 429) return true;
			}
			if (anyError.status === 429) return true;
		}

		return false;
	}

	/**
	 * Get config for a service, merging with overrides.
	 */
	private getConfig(
		serviceId: string,
		overrides?: Partial<RateLimitConfig>,
	): RateLimitConfig {
		const base = this.configs.get(serviceId) ?? {
			serviceId,
			maxRetries: 3,
			baseDelayMs: 1000,
			warningThreshold: 100,
		};

		return overrides ? { ...base, ...overrides } : base;
	}

	/**
	 * Sleep for a given duration.
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

/**
 * Format a tool result with rate limit warning appended.
 */
export function appendRateLimitWarning(
	result: string,
	warning: string | null | undefined,
): string {
	if (!warning) return result;
	return `${result}\n\n\u26A0\uFE0F ${warning}`;
}

/**
 * Create a rate limiter with default configurations.
 */
export function createRateLimiter(
	configs?: RateLimitConfig[],
): RateLimiter {
	return new RateLimiter(configs);
}
