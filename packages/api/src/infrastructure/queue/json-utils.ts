/**
 * Schemas and utilities for safely parsing JSON fields from the database.
 * Shared between QueueService and DirectDataProvider.
 */

/**
 * Safely parse a JSON field from the database.
 * Returns undefined if parsing fails.
 */
export function safeParseJsonArray(value: unknown): string[] | undefined {
	if (value === null || value === undefined) return undefined;

	try {
		const parsed = typeof value === "string" ? JSON.parse(value) : value;
		if (!Array.isArray(parsed)) return undefined;
		return parsed.every((v) => typeof v === "string")
			? (parsed as string[])
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * Safely parse a JSON field expecting Record<string, string>.
 * Returns undefined if parsing or validation fails.
 */
export function safeParseJsonRecord(
	value: unknown,
): Record<string, string> | undefined {
	if (value === null || value === undefined) return undefined;

	try {
		const parsed = typeof value === "string" ? JSON.parse(value) : value;
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
			return undefined;
		// Verify all values are strings
		for (const v of Object.values(parsed)) {
			if (typeof v !== "string") return undefined;
		}
		return parsed as Record<string, string>;
	} catch {
		return undefined;
	}
}

/**
 * Safely parse a JSON field expecting Record<string, unknown>.
 * Returns undefined if parsing fails.
 */
export function safeParseJsonObject(
	value: unknown,
): Record<string, unknown> | undefined {
	if (value === null || value === undefined) return undefined;

	try {
		const parsed = typeof value === "string" ? JSON.parse(value) : value;
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
			return undefined;
		return parsed as Record<string, unknown>;
	} catch {
		return undefined;
	}
}
