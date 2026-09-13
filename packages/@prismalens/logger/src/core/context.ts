// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestScope {
	requestId?: string;
	bindings: Record<string, unknown>;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestScope>();

export function runInRequestContext<T>(
	fn: () => T | Promise<T>,
	initial?: Record<string, unknown>,
): T | Promise<T> {
	const bindings: Record<string, unknown> = {
		...((initial?.context as object) ?? {}),
		...initial,
	};
	delete bindings.context;
	const requestId = (bindings.requestId ??
		bindings.request_id ??
		bindings.runId ??
		bindings.id) as string | undefined;
	return asyncLocalStorage.run({ requestId, bindings }, fn);
}

export function enrichContext(data: Record<string, unknown>): void {
	const scope = asyncLocalStorage.getStore();
	if (!scope) return;
	Object.assign(scope.bindings, (data.context as object) ?? {}, data);
	delete scope.bindings.context;
}

export const getRequestScope = () => asyncLocalStorage.getStore();
export const getRequestId = () => asyncLocalStorage.getStore()?.requestId;
export const getTraceId = () =>
	asyncLocalStorage.getStore()?.bindings.traceId as string | undefined;
export const getSpanId = () =>
	asyncLocalStorage.getStore()?.bindings.spanId as string | undefined;
export const hasRequestContext = () =>
	asyncLocalStorage.getStore() !== undefined;
export const getCurrentWideEvent = () => asyncLocalStorage.getStore()?.bindings;
