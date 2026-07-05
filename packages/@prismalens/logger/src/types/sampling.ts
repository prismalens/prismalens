// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SamplingReason } from "./wide-event.js";

/**
 * Result of a sampling decision.
 */
export interface SamplingDecision {
	/** Whether the event should be retained */
	shouldRetain: boolean;
	/** Reason for the decision */
	reason: SamplingReason;
}

/**
 * Sampler configuration options.
 */
export interface SamplerOptions {
	/** Whether sampling is enabled */
	enabled: boolean;
	/** Percentage of normal traffic to sample (0-100) */
	sampleRate: number;
	/** Latency threshold in ms - always retain if exceeded */
	latencyThresholdMs: number;
}
