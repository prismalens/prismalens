/**
 * LangGraph State Annotation
 *
 * Defines the state schema for the investigation workflow graph.
 * Uses LangGraph Annotations for graph state management.
 */

import type { BaseMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

import type { HandoffRecord } from "../../utils/handoff-manager.js";
import type { AlertContext, IncidentContext } from "../schemas/core.js";
import type {
	AdversaryChallenge,
	AgentExecutionRecord,
	Hypothesis,
	Recommendation,
} from "../schemas/findings.js";
import type { PendingAlert, PreGatheredContext } from "../schemas/pre-gathering.js";
import type {
	AgentError,
	ClonedRepoInfo,
	DataQualityInfo,
	Finding,
	Fix,
	HandoffRequest,
	SupervisorAgentName,
	SupervisorPhase,
	ValidationWindowLevel,
} from "../supervisor.js";
import {
	appendReducer,
	latestWinsReducer,
	mergeReducer,
	uniqueSetReducer,
} from "./reducers.js";

// =============================================================================
// INVESTIGATION STATE ANNOTATION
// =============================================================================

/**
 * Main Investigation Graph State
 * This is the root state annotation shared across all nodes in the main graph.
 *
 * Note: LangGraph Studio may show a type portability warning for this annotation
 * because it includes BaseMessage[] from @langchain/core. This is a known
 * limitation of TypeScript declaration emit with LangGraph's type system
 * and does not affect functionality.
 */
export const InvestigationStateAnnotation = Annotation.Root({
	// =========================================================================
	// Job Metadata
	// =========================================================================

	/** Investigation ID from the database */
	investigationId: Annotation<string>,

	/** Incident ID this investigation belongs to */
	incidentId: Annotation<string>,

	// =========================================================================
	// Incident Context (Primary Unit of Investigation)
	// =========================================================================

	/** The incident being investigated - primary context for the investigation */
	incident: Annotation<IncidentContext | null>({
		reducer: (current, update) => update ?? current,
		default: () => null,
	}),

	// =========================================================================
	// Alert Context (Supporting Data)
	// =========================================================================

	/** All alerts associated with this incident */
	alerts: Annotation<AlertContext[]>({
		reducer: appendReducer,
		default: () => [],
	}),

	/** Primary alert that triggered the investigation, useful for quick access */
	primaryAlert: Annotation<AlertContext | null>,

	// =========================================================================
	// Agent Communication
	// =========================================================================

	/** Message history for agent communication */
	messages: Annotation<BaseMessage[]>({
		reducer: messagesStateReducer,
		default: () => [],
	}),

	// =========================================================================
	// Pre-Gathered Context (before Commander)
	// =========================================================================

	/**
	 * Pre-gathered context fetched before Commander starts.
	 * Contains alerts, changes, similar incidents, service context, and metrics.
	 * Based on BigPanda enrichment pattern - 60-90% of incidents are change-related.
	 */
	preGatheredContext: Annotation<PreGatheredContext | null>({
		reducer: (current, update) => update ?? current,
		default: () => null,
	}),

	/**
	 * Alerts that arrived during an ongoing investigation.
	 * Commander can use these for awareness during analysis.
	 */
	pendingAlerts: Annotation<PendingAlert[]>({
		reducer: appendReducer,
		default: () => [],
	}),

	// =========================================================================
	// Investigation Findings
	// =========================================================================

	/** Hypotheses formed by Detective agent */
	hypotheses: Annotation<Hypothesis[]>({
		reducer: appendReducer,
		default: () => [],
	}),

	/** Challenges from Adversary agent (Devil's Advocate) */
	adversaryChallenges: Annotation<AdversaryChallenge[]>({
		reducer: appendReducer,
		default: () => [],
	}),

	/** Recommendations from Surgeon agent */
	recommendations: Annotation<Recommendation[]>({
		reducer: appendReducer,
		default: () => [],
	}),

	// =========================================================================
	// Execution Tracking
	// =========================================================================

	/** Record of all agent executions */
	agentExecutions: Annotation<AgentExecutionRecord[]>({
		reducer: appendReducer,
		default: () => [],
	}),

	/** Data quality scores from various sources */
	dataQuality: Annotation<DataQualityInfo>({
		reducer: mergeReducer,
		default: () => ({}),
	}),

	/**
	 * Validation window level for progressive time expansion.
	 * Starts at 1, expands to 2 or 3 if insufficient data is found.
	 */
	validationWindowLevel: Annotation<ValidationWindowLevel>({
		reducer: latestWinsReducer,
		default: () => 1,
	}),

	/**
	 * Warning message if data quality is below threshold.
	 * Set when proceeding with low-quality data.
	 */
	dataQualityWarning: Annotation<string | undefined>({
		reducer: latestWinsReducer,
		default: () => undefined,
	}),

	/** Data sources used during investigation */
	dataSourcesUsed: Annotation<string[]>({
		reducer: uniqueSetReducer,
		default: () => [],
	}),

	// =========================================================================
	// Final Results
	// =========================================================================

	/** Executive summary of the investigation */
	summary: Annotation<string | null>,

	/** Identified root cause */
	rootCause: Annotation<string | null>,

	/** Root cause category */
	rootCauseCategory: Annotation<
		"code" | "config" | "infrastructure" | "external" | "unknown" | null
	>,

	/** Overall confidence score (0-100) */
	confidence: Annotation<number | null>,

	/** Analysis method used */
	analysisMethod: Annotation<string | null>,

	// =========================================================================
	// Workflow Control
	// =========================================================================

	/** Current workflow status */
	status: Annotation<
		"pending" | "validating" | "running" | "completed" | "failed"
	>({
		reducer: (x, y) => y ?? x,
		default: () => "pending",
	}),

	/** Error message if workflow failed */
	error: Annotation<string | null>,

	/** Raw output from DeepAgent commander (for debugging) */
	commanderResult: Annotation<unknown>,

	/** Iteration count for max iterations check */
	iterationCount: Annotation<number>({
		reducer: (x, y) => y ?? x,
		default: () => 0,
	}),

	// =========================================================================
	// Supervisor Pattern State (New Architecture)
	// =========================================================================

	/**
	 * Current phase in the Supervisor workflow.
	 * Replaces the linear DeepAgents flow with structured phases.
	 */
	phase: Annotation<SupervisorPhase>({
		reducer: latestWinsReducer,
		default: () => "gathering",
	}),

	/**
	 * Currently active agent in the Supervisor workflow.
	 * Used for tracking and debugging.
	 */
	currentAgent: Annotation<SupervisorAgentName | undefined>({
		reducer: latestWinsReducer,
		default: () => undefined,
	}),

	/**
	 * Number of targeted gather iterations.
	 * Limited to 2 to prevent infinite loops.
	 */
	gatherIterations: Annotation<number>({
		reducer: latestWinsReducer,
		default: () => 0,
	}),

	/**
	 * Findings from gatherer agents (append-only).
	 * Each gatherer appends its findings to this array.
	 */
	findings: Annotation<Finding[]>({
		reducer: appendReducer,
		default: () => [],
	}),

	/**
	 * Handoff request from Detective to request targeted gathering.
	 * Cleared after the targeted gather completes.
	 */
	handoffRequest: Annotation<HandoffRequest | undefined>({
		reducer: latestWinsReducer,
		default: () => undefined,
	}),

	/**
	 * History of all handoff requests with their lifecycle status.
	 * Used for:
	 * - Providing feedback to Detective about denied requests
	 * - Progress-based termination decisions
	 * - Observability and debugging
	 *
	 * @see HandoffRecord in utils/handoff-manager.ts
	 */
	handoffHistory: Annotation<HandoffRecord[]>({
		reducer: appendReducer,
		default: () => [],
	}),

	/**
	 * Fix proposal from Surgeon agent.
	 */
	fix: Annotation<Fix | undefined>({
		reducer: latestWinsReducer,
		default: () => undefined,
	}),

	/**
	 * Paths to cloned repositories for code analysis.
	 * Key is serviceId (or "primary" for single-repo scenarios).
	 * Value is the local filesystem path to the cloned repo.
	 *
	 * Set by cloneIfNeeded node when repo cloning is required.
	 * Multi-repo incidents (microservices) will have multiple entries.
	 *
	 * Example:
	 * {
	 *   "api-svc": "/tmp/prismalens-workspaces/inv-123/api-svc",
	 *   "db-svc": "/tmp/prismalens-workspaces/inv-123/db-svc"
	 * }
	 */
	clonePaths: Annotation<Record<string, string> | undefined>({
		reducer: latestWinsReducer,
		default: () => undefined,
	}),

	/**
	 * Detailed information about cloned repositories.
	 * Provides richer metadata than clonePaths for debugging and observability.
	 */
	clonedRepos: Annotation<ClonedRepoInfo[] | undefined>({
		reducer: (existing, update) => update ?? existing,
		default: () => undefined,
	}),

	/**
	 * Non-blocking errors from agents.
	 * Investigation continues even if individual agents fail.
	 */
	agentErrors: Annotation<AgentError[]>({
		reducer: appendReducer,
		default: () => [],
	}),

	/**
	 * Gatherers that are structurally unavailable (not query failures).
	 * Examples: code-searcher with no clone paths, log-gatherer with no integration.
	 * These are permanently blocked from re-requests, unlike query failures.
	 * Detective can still request the same gatherer with different queries if
	 * the gatherer ran but found no results (that's not a structural failure).
	 */
	unavailableGatherers: Annotation<string[]>({
		reducer: uniqueSetReducer,
		default: () => [],
	}),

	/**
	 * Final analysis mode flag.
	 * When true, Detective MUST form hypotheses and CANNOT request more data.
	 * Set when termination is triggered (max handoffs, no progress, etc.).
	 * Ensures Detective analyzes collected data before completing.
	 */
	finalAnalysisOnly: Annotation<boolean>({
		reducer: latestWinsReducer,
		default: () => false,
	}),

	// =========================================================================
	// Detective ↔ Adversary Dialogue Flags
	// =========================================================================

	/**
	 * When true, Detective requests adversary challenge (direct routing).
	 * Triggers when high confidence (≥85%) with thin evidence (≤2 items).
	 */
	needsAdversaryChallenge: Annotation<boolean>({
		reducer: latestWinsReducer,
		default: () => false,
	}),

	/**
	 * When true, Adversary requests Detective refinement (direct routing).
	 * Set when adversary identifies issues that need Detective to address.
	 */
	adversaryRequestsRefinement: Annotation<boolean>({
		reducer: latestWinsReducer,
		default: () => false,
	}),

	/**
	 * Timestamp of last scope alignment check by Adversary.
	 * Used to determine when to invoke adversary for periodic scope checks.
	 */
	lastScopeCheck: Annotation<string | undefined>({
		reducer: latestWinsReducer,
		default: () => undefined,
	}),

	/**
	 * Flag indicating findings may be deviating from incident scope.
	 * Set by quality gate when relevance score is low.
	 */
	shouldCheckScope: Annotation<boolean>({
		reducer: latestWinsReducer,
		default: () => false,
	}),
});

/**
 * Type for the investigation state
 */
export type InvestigationState = typeof InvestigationStateAnnotation.State;

/**
 * Type for state update (partial state)
 */
export type InvestigationStateUpdate = Partial<InvestigationState>;
