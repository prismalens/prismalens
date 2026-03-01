/**
 * Retry predicate for LangGraph retryPolicy.
 *
 * Identifies transient errors (rate limits, server errors, network issues)
 * that are safe to retry with exponential backoff.
 */

/** HTTP status codes that indicate transient server errors */
const RETRYABLE_STATUS_RE = /\b(429|500|502|503)\b/

/** Network-level errors safe to retry */
const RETRYABLE_NETWORK_ERRORS = [
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
]

export function isRetryableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    RETRYABLE_STATUS_RE.test(msg) ||
    msg.includes("timeout") ||
    RETRYABLE_NETWORK_ERRORS.some((code) => msg.includes(code))
  )
}
