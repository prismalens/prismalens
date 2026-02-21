/**
 * Graceful fetch wrapper — catches errors and returns a fallback value.
 *
 * Used by the scout node to fetch data sources in parallel without
 * one failure crashing the entire investigation.
 */

export interface SafeFetchResult<T> {
  data: T
  success: boolean
  error?: string
}

export async function safeFetch<T>(
  fn: () => Promise<T>,
  fallback: T,
  label: string,
): Promise<SafeFetchResult<T>> {
  try {
    const data = await fn()
    return { data, success: true }
  } catch (thrown) {
    const message =
      thrown instanceof Error ? thrown.message : String(thrown)
    return { data: fallback, success: false, error: `${label}: ${message}` }
  }
}
