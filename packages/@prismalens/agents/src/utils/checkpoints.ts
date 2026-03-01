/**
 * Checkpoint utilities for investigation state management.
 *
 * Provides helpers for reading checkpoints from a BaseCheckpointSaver,
 * extracting state, and finding the best hypothesis.
 */

import type { BaseCheckpointSaver, CheckpointTuple } from "@langchain/langgraph-checkpoint"
import type { Hypothesis } from "../types/results.js"

/**
 * Get the latest checkpoint for a thread.
 * Returns the most recent CheckpointTuple or null if none exists.
 */
export async function getCheckpoint(
  checkpointer: BaseCheckpointSaver,
  threadId: string,
): Promise<CheckpointTuple | null> {
  const config = { configurable: { thread_id: threadId } }
  const tuple = await checkpointer.getTuple(config)
  return tuple ?? null
}

/**
 * List all checkpoints for a thread (most recent first).
 */
export async function listCheckpoints(
  checkpointer: BaseCheckpointSaver,
  threadId: string,
): Promise<CheckpointTuple[]> {
  const config = { configurable: { thread_id: threadId } }
  const tuples: CheckpointTuple[] = []
  for await (const tuple of checkpointer.list(config)) {
    tuples.push(tuple)
  }
  return tuples
}

/**
 * Extract channel_values (i.e. the graph state) from a CheckpointTuple.
 * Returns null if the tuple has no checkpoint or no channel_values.
 */
export function getStateFromCheckpoint<T>(
  tuple: CheckpointTuple | null,
): T | null {
  if (!tuple?.checkpoint) return null
  const values = tuple.checkpoint.channel_values as unknown as T | undefined
  return values ?? null
}

/**
 * Extract the timestamp from a CheckpointTuple.
 * Returns the checkpoint's `ts` field or null.
 */
export function getCheckpointTimestamp(
  tuple: CheckpointTuple | null,
): string | null {
  if (!tuple?.checkpoint) return null
  return tuple.checkpoint.ts ?? null
}

/**
 * Get the best hypothesis from an array of hypotheses or a state object.
 *
 * Accepts either:
 * - Hypothesis[] directly
 * - An object with a `hypotheses` property (e.g., InvestigationState)
 *
 * Returns the hypothesis with the highest confidence score, or null.
 */
export function getBestHypothesis(
  input: Hypothesis[] | { hypotheses?: Hypothesis[] },
): Hypothesis | null {
  const hypotheses = Array.isArray(input) ? input : (input.hypotheses ?? [])

  if (hypotheses.length === 0) return null

  return hypotheses.reduce((best, current) =>
    current.confidence > best.confidence ? current : best,
  )
}
