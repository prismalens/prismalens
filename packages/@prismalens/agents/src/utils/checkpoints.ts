/**
 * Checkpoint utilities for investigation state management.
 *
 * Provides helpers for reading checkpoints, extracting state, and
 * finding the best hypothesis from investigation state.
 */

import type { Hypothesis } from "../types/results.js"

/**
 * Get the latest checkpoint for an investigation.
 * Stub: returns null until checkpointer is integrated.
 */
export async function getCheckpoint(
  _investigationId: string,
): Promise<unknown | null> {
  return null
}

/**
 * List all checkpoints for an investigation.
 * Stub: returns empty array until checkpointer is integrated.
 */
export async function listCheckpoints(
  _investigationId: string,
): Promise<unknown[]> {
  return []
}

/**
 * Get state from a checkpoint.
 * Stub: returns null until checkpointer is integrated.
 */
export async function getStateFromCheckpoint<T>(
  _checkpoint: unknown,
): Promise<T | null> {
  return null
}

/**
 * Get timestamp from a checkpoint.
 * Stub: returns null until checkpointer is integrated.
 */
export async function getCheckpointTimestamp(
  _checkpoint: unknown,
): Promise<string | null> {
  return null
}

/**
 * Get the best hypothesis from an array of hypotheses or a state object.
 *
 * Accepts either:
 * - Hypothesis[] directly
 * - An object with a `hypotheses` property (e.g., InvestigationState)
 * - Any value (returns null for backward compat with old stub)
 *
 * Returns the hypothesis with the highest confidence score, or null.
 */
export function getBestHypothesis(
  input: Hypothesis[] | { hypotheses?: Hypothesis[] } | unknown,
): Hypothesis | null {
  let hypotheses: Hypothesis[]

  if (Array.isArray(input)) {
    hypotheses = input
  } else if (
    input &&
    typeof input === "object" &&
    "hypotheses" in input &&
    Array.isArray((input as { hypotheses: unknown }).hypotheses)
  ) {
    hypotheses = (input as { hypotheses: Hypothesis[] }).hypotheses
  } else {
    return null
  }

  if (hypotheses.length === 0) return null

  return hypotheses.reduce((best, current) =>
    current.confidence > best.confidence ? current : best,
  )
}
