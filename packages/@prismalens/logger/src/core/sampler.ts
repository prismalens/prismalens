// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LoggingConfig } from "@prismalens/config";
import type { SamplerOptions, SamplingDecision } from "../types/sampling.js";
import type { WideEvent } from "../types/wide-event.js";

/**
 * Tail sampler implementing the sampling strategy.
 *
 * Sampling rules (in priority order):
 * 1. Always retain errors (100% of 5xx and exceptions)
 * 2. Always retain slow requests (exceeding latency threshold)
 * 3. Always retain VIP traffic (flagged sessions)
 * 4. Always retain feature test traffic
 * 5. Randomly sample normal traffic (configurable %)
 *
 * The key insight is that sampling decision is made at the END of the request
 * when we know the outcome (tail sampling), not at the beginning.
 */
export class TailSampler {
	private readonly options: SamplerOptions;

	constructor(
		config: Pick<
			LoggingConfig,
			| "PRISMALENS_LOG_SAMPLING_ENABLED"
			| "PRISMALENS_LOG_SAMPLING_RATE"
			| "PRISMALENS_LOG_SAMPLING_LATENCY_THRESHOLD"
		>,
	) {
		this.options = {
			enabled: config.PRISMALENS_LOG_SAMPLING_ENABLED,
			sampleRate: config.PRISMALENS_LOG_SAMPLING_RATE,
			latencyThresholdMs: config.PRISMALENS_LOG_SAMPLING_LATENCY_THRESHOLD,
		};
	}

	/**
	 * Create a sampler with explicit options (for testing).
	 */
	static withOptions(options: SamplerOptions): TailSampler {
		return new TailSampler({
			PRISMALENS_LOG_SAMPLING_ENABLED: options.enabled,
			PRISMALENS_LOG_SAMPLING_RATE: options.sampleRate,
			PRISMALENS_LOG_SAMPLING_LATENCY_THRESHOLD: options.latencyThresholdMs,
		});
	}

	/**
	 * Determine if a wide event should be retained or dropped.
	 * Called at the END of a request when all context is available.
	 */
	shouldSample(event: Partial<WideEvent>): SamplingDecision {
		// Sampling disabled = retain everything
		if (!this.options.enabled) {
			return { shouldRetain: true, reason: "force_retain" };
		}

		// Rule 1: Always retain errors
		if (this.isError(event)) {
			return { shouldRetain: true, reason: "error" };
		}

		// Rule 2: Always retain slow requests
		if (this.isSlowRequest(event)) {
			return { shouldRetain: true, reason: "slow_request" };
		}

		// Rule 3: Always retain VIP traffic
		if (this.isVipTraffic(event)) {
			return { shouldRetain: true, reason: "vip_traffic" };
		}

		// Rule 4: Always retain feature test traffic
		if (this.isFeatureTestTraffic(event)) {
			return { shouldRetain: true, reason: "feature_test" };
		}

		// Rule 5: Random sampling for normal traffic
		if (this.shouldRandomSample()) {
			return { shouldRetain: true, reason: "random_sample" };
		}

		// Default: drop
		return { shouldRetain: false, reason: "random_sample" };
	}

	/**
	 * Check if the event represents an error.
	 */
	private isError(event: Partial<WideEvent>): boolean {
		// Check for error object
		if (event.error) return true;

		// Check for 5xx status codes
		const statusCode = event.response?.status_code;
		if (statusCode && statusCode >= 500) return true;

		// Check for error-level logs
		if (event.log?.level === "error") return true;

		return false;
	}

	/**
	 * Check if the request exceeded the latency threshold.
	 */
	private isSlowRequest(event: Partial<WideEvent>): boolean {
		const duration = event.duration_ms;
		return duration !== undefined && duration > this.options.latencyThresholdMs;
	}

	/**
	 * Check if this is VIP traffic that should always be retained.
	 */
	private isVipTraffic(event: Partial<WideEvent>): boolean {
		// Check for VIP markers in tags
		if (event.tags?.includes("vip")) return true;

		// Check for VIP marker in context
		if (event.context?.["vip"] === true) return true;

		// Check for VIP user role
		if (event.user?.role === "vip" || event.user?.role === "enterprise") {
			return true;
		}

		return false;
	}

	/**
	 * Check if this is feature test traffic that should be retained.
	 */
	private isFeatureTestTraffic(event: Partial<WideEvent>): boolean {
		const flags = event.feature_flags;
		if (!flags) return false;

		// Retain if any experimental/test flags are active
		return Object.entries(flags).some(([key, value]) => {
			const isTestFlag =
				key.startsWith("test_") ||
				key.startsWith("experiment_") ||
				key.startsWith("beta_");
			return isTestFlag && value;
		});
	}

	/**
	 * Determine if this request should be randomly sampled.
	 */
	private shouldRandomSample(): boolean {
		return Math.random() * 100 < this.options.sampleRate;
	}

	/**
	 * Get current sampler options (for debugging).
	 */
	getOptions(): Readonly<SamplerOptions> {
		return { ...this.options };
	}
}
