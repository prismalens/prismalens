import type { WideEvent } from "../types/wide-event.js";

const TRUNCATION_MARKER = "[TRUNCATED]";

/**
 * Truncate a wide event to fit within the max payload size.
 * Prioritizes preserving essential fields over verbose ones.
 */
export function truncatePayload(
	event: Partial<WideEvent>,
	maxSize: number,
): Partial<WideEvent> {
	const serialized = JSON.stringify(event);

	if (serialized.length <= maxSize) {
		return event;
	}

	const result = { ...event };

	// First, truncate stack traces
	if (result.error?.stack && result.error.stack.length > 1000) {
		result.error = {
			...result.error,
			stack: result.error.stack.substring(0, 1000) + `\n${TRUNCATION_MARKER}`,
		};
	}

	// Truncate nested cause chains
	if (result.error?.cause) {
		result.error = {
			...result.error,
			cause: truncateErrorCause(result.error.cause, 2),
		};
	}

	// Truncate log args
	if (result.log?.args && JSON.stringify(result.log.args).length > 2000) {
		result.log = {
			...result.log,
			args: [TRUNCATION_MARKER],
		};
	}

	// Truncate request query params
	if (result.request?.query) {
		const queryStr = JSON.stringify(result.request.query);
		if (queryStr.length > 2000) {
			result.request = {
				...result.request,
				query: { _truncated: true, _originalSize: queryStr.length },
			};
		}
	}

	// Truncate context if still too large
	if (result.context && JSON.stringify(result.context).length > 5000) {
		result.context = {
			_truncated: true,
			_originalSize: JSON.stringify(event.context).length,
		};
	}

	// Truncate external call metrics
	if (result.metrics?.external_calls && result.metrics.external_calls.length > 50) {
		result.metrics = {
			...result.metrics,
			external_calls: [
				...result.metrics.external_calls.slice(0, 50),
				{ service: TRUNCATION_MARKER, method: "", duration_ms: 0 },
			],
		};
	}

	// Final check - if still too large, remove non-essential fields
	const finalCheck = JSON.stringify(result);
	if (finalCheck.length > maxSize) {
		// Remove verbose fields progressively
		delete result.request?.headers;
		delete result.response?.headers;
		delete result.metrics;

		// Add truncation indicator
		result.tags = [...(result.tags || []), "_truncated"];
	}

	return result;
}

/**
 * Truncate error cause chain to a maximum depth.
 */
function truncateErrorCause(
	cause: WideEvent["error"],
	maxDepth: number,
): WideEvent["error"] {
	if (!cause || maxDepth <= 0) {
		return cause
			? {
					type: cause.type,
					message: `${cause.message} ${TRUNCATION_MARKER}`,
				}
			: undefined;
	}

	return {
		...cause,
		stack: cause.stack
			? cause.stack.substring(0, 500) + `\n${TRUNCATION_MARKER}`
			: undefined,
		cause: cause.cause
			? truncateErrorCause(cause.cause, maxDepth - 1)
			: undefined,
	};
}

/**
 * Truncate a string to a maximum length.
 */
export function truncateString(str: string, maxLength: number): string {
	if (str.length <= maxLength) {
		return str;
	}
	return str.substring(0, maxLength - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}
