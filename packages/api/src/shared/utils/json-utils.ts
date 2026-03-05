/**
 * Schemas and utilities for safely parsing JSON fields from the database.
 * Returns undefined on parse failure — callers should coalesce to null or a default.
 */

/**
 * Safely parse a JSON field expecting a string array.
 * Returns undefined if parsing fails or values aren't strings.
 */
export function safeParseJsonArray(value: unknown): string[] | undefined {
  if (value === null || value === undefined) return undefined;

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.every((v) => typeof v === 'string')
      ? (parsed as string[])
      : undefined;
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
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
