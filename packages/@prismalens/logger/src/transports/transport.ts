// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LogLevel } from "../types/wide-event.js";

/**
 * Base interface for log transports.
 */
export interface Transport {
	/**
	 * Write a formatted log line.
	 */
	write(data: string, level: LogLevel): void;

	/**
	 * Close the transport and release resources.
	 */
	close(): void;
}

/**
 * Transport options common to all transports.
 */
export interface TransportOptions {
	/** Minimum log level for this transport */
	minLevel?: LogLevel;
}
