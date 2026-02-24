/**
 * Investigation progress event types for streaming.
 *
 * Emitted by the executor's stream() method. Consumers (QueueService, Worker)
 * iterate these events for real-time progress and final results.
 */

import type { InvestigationResult } from "./results.js"

/**
 * Union type for all investigation progress events.
 */
export type InvestigationProgressEvent =
  | NodeCompleteEvent
  | ProgressEvent
  | RoutingEvent
  | HypothesisFormedEvent
  | RecommendationAddedEvent
  | StalledEvent
  | CompletedEvent
  | ErrorEvent

/**
 * Emitted after a graph node completes execution.
 */
export interface NodeCompleteEvent {
  type: "node_complete"
  node: string
  updates: Record<string, unknown>
}

/**
 * Emitted from inside nodes via config.writer() for granular progress.
 */
export interface ProgressEvent {
  type: "progress"
  agent: string
  message: string
}

/**
 * Emitted when the supervisor routes to a new agent.
 */
export interface RoutingEvent {
  type: "routing"
  agent: string
  reasoning: string
}

/**
 * Emitted when the analyst forms a new hypothesis.
 */
export interface HypothesisFormedEvent {
  type: "hypothesis_formed"
  hypothesis: string
  confidence: number
}

/**
 * Emitted when the resolver adds a recommendation.
 */
export interface RecommendationAddedEvent {
  type: "recommendation_added"
  title: string
  priority: string
}

/**
 * Emitted when the supervisor detects a stall (no forward progress).
 */
export interface StalledEvent {
  type: "stalled"
  reason: string
}

/**
 * Emitted when the investigation completes (final event in stream).
 */
export interface CompletedEvent {
  type: "completed"
  result: InvestigationResult
}

/**
 * Emitted when the investigation encounters an unrecoverable error.
 */
export interface ErrorEvent {
  type: "error"
  status: "timeout" | "failed"
  message: string
}
