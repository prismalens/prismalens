/**
 * Relative timeline utility for scenario test data.
 *
 * Creates ISO timestamp strings relative to a fixed epoch (T=0).
 * Ensures deterministic, reproducible timestamps across test runs.
 */

interface TimeOffset {
  hours?: number
  minutes?: number
  seconds?: number
}

interface Timeline {
  /** Current time (T=0) as ISO string */
  now(): string
  /** Time before T=0 */
  minus(offset: TimeOffset): string
  /** Time after T=0 */
  plus(offset: TimeOffset): string
  /** Raw epoch milliseconds */
  epoch: number
}

function offsetToMs(offset: TimeOffset): number {
  return (
    (offset.hours ?? 0) * 3600_000 +
    (offset.minutes ?? 0) * 60_000 +
    (offset.seconds ?? 0) * 1000
  )
}

/**
 * Create a timeline anchored at a fixed epoch.
 *
 * @param fixedEpoch - Epoch in ms. Defaults to 2025-01-15T10:00:00Z.
 */
export function makeTimeline(
  fixedEpoch = Date.UTC(2025, 0, 15, 10, 0, 0),
): Timeline {
  return {
    now: () => new Date(fixedEpoch).toISOString(),
    minus: (offset) => new Date(fixedEpoch - offsetToMs(offset)).toISOString(),
    plus: (offset) => new Date(fixedEpoch + offsetToMs(offset)).toISOString(),
    epoch: fixedEpoch,
  }
}
