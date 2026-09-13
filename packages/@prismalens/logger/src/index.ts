// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ServiceInfo {
	name: string;
	version: string;
	environment: string;
}

export interface LoggerOptions {
	context?: string;
}

export {
	enrichContext,
	getCurrentWideEvent,
	getRequestId,
	getRequestScope,
	getSpanId,
	getTraceId,
	hasRequestContext,
	runInRequestContext,
} from "./core/context.js";
export { createChildLogger, getLogger, Logger } from "./core/logger.js";
