// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomBytes } from "node:crypto";

/**
 * Generate a unique request ID.
 * Format: req_<timestamp>_<random>
 */
export function generateRequestId(): string {
	const timestamp = Date.now().toString(36);
	const random = randomBytes(8).toString("hex");
	return `req_${timestamp}_${random}`;
}

/**
 * Generate a span ID for tracing.
 * Format: 16 hex characters
 */
export function generateSpanId(): string {
	return randomBytes(8).toString("hex");
}

/**
 * Generate a trace ID for distributed tracing.
 * Format: 32 hex characters (compatible with W3C Trace Context)
 */
export function generateTraceId(): string {
	return randomBytes(16).toString("hex");
}
