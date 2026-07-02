/**
 * Shared provider types
 *
 * AuthenticatedRequestFn is the core abstraction — providers never see raw tokens.
 * AuthManager.request() is bound to a connectionId and injected as this function.
 */

/**
 * Bound authenticated request function — created by binding
 * AuthManager.request() to a specific connectionId.
 */
export type AuthenticatedRequestFn = (
	method: string,
	path: string,
	options?: { body?: string; headers?: Record<string, string> },
) => Promise<Response>;
