// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	enrichContext,
	getRequestId,
	getTraceId,
	runInRequestContext,
} from "../../core/context.js";
import { Logger } from "../../core/logger.js";
import type { ServiceInfo } from "../../index.js";

export interface StandaloneLoggerOptions {
	service: ServiceInfo;
	context?: string;
}

export function createLogger(options: StandaloneLoggerOptions): Logger {
	Logger.setServiceInfo(options.service);
	return new Logger({ context: options.context });
}

export const runWithWideEvent = <T>(
	jobId: string,
	fn: () => Promise<T> | T,
	initial?: Record<string, unknown>,
): Promise<T> =>
	runInRequestContext(async () => fn(), {
		...initial,
		requestId: jobId,
	}) as Promise<T>;

export const runWithWideEventSync = <T>(
	jobId: string,
	fn: () => T,
	initial?: Record<string, unknown>,
): T => runInRequestContext(fn, { ...initial, requestId: jobId }) as T;

export { enrichContext, getRequestId, getTraceId, runInRequestContext };
