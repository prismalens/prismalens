import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestScope, WideEvent } from "../types/index.js";
import { generateRequestId, generateSpanId } from "../utils/id-generator.js";

/**
 * AsyncLocalStorage for request-scoped wide event context.
 * This allows adding context throughout request processing
 * without explicit parameter passing.
 */
const requestContext = new AsyncLocalStorage<RequestScope>();

/**
 * Run a function within a new request context.
 * Creates a new scope with a unique request ID.
 */
export function runInRequestContext<T>(
	fn: () => T | Promise<T>,
	initialContext?: Partial<WideEvent>,
): T | Promise<T> {
	const requestId = initialContext?.request_id || generateRequestId();

	const scope: RequestScope = {
		requestId,
		spanId: generateSpanId(),
		traceId: initialContext?.trace_id,
		startTime: Date.now(),
		wideEvent: {
			request_id: requestId,
			timestamp: new Date().toISOString(),
			...initialContext,
		},
	};

	return requestContext.run(scope, fn);
}

/**
 * Get current request scope (returns undefined outside request context).
 */
export function getRequestScope(): RequestScope | undefined {
	return requestContext.getStore();
}

/**
 * Add context to the current wide event.
 * Merges with existing context (does not replace).
 */
export function enrichContext(data: Partial<WideEvent>): void {
	const scope = getRequestScope();
	if (!scope) return;

	// Deep merge specific fields
	if (data.context) {
		scope.wideEvent.context = { ...scope.wideEvent.context, ...data.context };
	}
	if (data.metrics) {
		scope.wideEvent.metrics = { ...scope.wideEvent.metrics, ...data.metrics };
	}
	if (data.user) {
		scope.wideEvent.user = { ...scope.wideEvent.user, ...data.user };
	}
	if (data.request) {
		scope.wideEvent.request = { ...scope.wideEvent.request, ...data.request };
	}
	if (data.response) {
		scope.wideEvent.response = { ...scope.wideEvent.response, ...data.response };
	}
	if (data.tags) {
		scope.wideEvent.tags = [...(scope.wideEvent.tags || []), ...data.tags];
	}
	if (data.feature_flags) {
		scope.wideEvent.feature_flags = {
			...scope.wideEvent.feature_flags,
			...data.feature_flags,
		};
	}

	// Direct assignments for other fields
	if (data.error !== undefined) {
		scope.wideEvent.error = data.error;
	}
	if (data.service !== undefined) {
		scope.wideEvent.service = data.service;
	}
	if (data.log !== undefined) {
		scope.wideEvent.log = data.log;
	}
}

/**
 * Get the current wide event (snapshot).
 * Includes calculated duration.
 */
export function getCurrentWideEvent(): Partial<WideEvent> | undefined {
	const scope = getRequestScope();
	if (!scope) return undefined;

	return {
		...scope.wideEvent,
		duration_ms: Date.now() - scope.startTime,
	};
}

/**
 * Get current request ID (for correlation).
 */
export function getRequestId(): string | undefined {
	return getRequestScope()?.requestId;
}

/**
 * Get current trace ID (for distributed tracing).
 */
export function getTraceId(): string | undefined {
	return getRequestScope()?.traceId;
}

/**
 * Get current span ID.
 */
export function getSpanId(): string | undefined {
	return getRequestScope()?.spanId;
}

/**
 * Check if currently running within a request context.
 */
export function hasRequestContext(): boolean {
	return getRequestScope() !== undefined;
}
