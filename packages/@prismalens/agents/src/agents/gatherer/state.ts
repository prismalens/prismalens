/**
 * Gatherer state annotation.
 *
 * Extends MessagesAnnotation (required by createReactAgent) with
 * additional channels for incident context and existing gathered data.
 */

import { Annotation, MessagesAnnotation } from "@langchain/langgraph"
import type { IncidentContext, AlertContext } from "../../types/contexts.js"
import type { GatheredData } from "../../types/state.js"

/**
 * GathererStateAnnotation — extends MessagesAnnotation for createReactAgent.
 *
 * Custom channels let the gatherer's prompt function read incident context
 * without it being in the messages array. These are set by the wrapper
 * function before invoking the agent.
 */
export const GathererStateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  incident: Annotation<IncidentContext | null>(),
  alerts: Annotation<AlertContext[]>(),
  gatheredData: Annotation<GatheredData>(),
})

export type GathererState = typeof GathererStateAnnotation.State
