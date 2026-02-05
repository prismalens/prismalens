/**
 * Supervisor Pattern Types
 *
 * Types for the Supervisor Pattern architecture that replaces DeepAgents.
 * Enables parallel execution, handoff-based routing, and shared state.
 */

import { z } from "zod";

// =============================================================================
// SUPERVISOR PHASES & AGENT NAMES
// =============================================================================

/**
 * Supervisor workflow phase
 */
export type SupervisorPhase =
	| "gathering"        // Initial parallel gathering
	| "analyzing"        // Detective forming hypothesis
	| "targeted_gather"  // Additional gathering based on Detective's request
	| "fixing"           // Surgeon proposing fixes
	| "complete";        // Investigation complete

/**
 * Canonical list of supervisor agent names.
 * Derive both types and Zod schemas from this to avoid duplication.
 */
export const SUPERVISOR_AGENT_NAMES = [
	"log-gatherer",
	"code-searcher",
	"change-tracker",
	"detective",
	"adversary",
	"surgeon",
] as const;

/**
 * Agent names for the Supervisor Pattern
 */
export type SupervisorAgentName = (typeof SUPERVISOR_AGENT_NAMES)[number];

// =============================================================================
// FINDING VALIDATION
// =============================================================================

/**
 * Validation metadata for a finding
 * Added by validation layer after gatherer produces findings
 */
export interface FindingValidation {
	/** Whether finding timestamp is within incident time window */
	timeAligned: boolean;
	/** Whether finding service matches incident service or dependencies */
	serviceMatched: boolean;
	/** IDs of other findings this correlates with */
	correlatedWith: string[];
	/** Validation warnings (not errors, finding is still used) */
	warnings: string[];
}

/**
 * Zod schema for FindingValidation
 */
export const FindingValidationSchema = z.object({
	timeAligned: z.boolean(),
	serviceMatched: z.boolean(),
	correlatedWith: z.array(z.string()),
	warnings: z.array(z.string()),
});

// =============================================================================
// FINDING
// =============================================================================

/**
 * Finding from a gatherer agent
 * All gatherers output findings with a common structure
 */
export interface Finding {
	/** Unique ID for correlation tracking */
	id?: string;
	/** Which agent produced this finding */
	source: "log-gatherer" | "code-searcher" | "change-tracker";
	/** Type of finding */
	type: "log" | "code" | "commit" | "deployment" | "error" | "metric" | "config";
	/** Human-readable summary */
	summary: string;
	/** Detailed data (varies by type) */
	details: unknown;
	/** Relevance score 0-100 */
	relevance: number;
	/** When this finding relates to (if temporal) */
	timestamp?: string;
	/** Validation metadata added by validation layer */
	validation?: FindingValidation;
}

/**
 * Zod schema for Finding validation
 */
export const FindingSchema = z.object({
	id: z.string().optional(),
	source: z.enum(["log-gatherer", "code-searcher", "change-tracker"]),
	type: z.enum(["log", "code", "commit", "deployment", "error", "metric", "config"]),
	summary: z.string(),
	details: z.unknown(),
	relevance: z.number().min(0).max(100),
	timestamp: z.string().optional(),
	validation: FindingValidationSchema.optional(),
});

// =============================================================================
// VALIDATION WINDOW LEVEL
// =============================================================================

/**
 * Validation window level for progressive time expansion
 * Level 1: Narrow window (fast, most relevant)
 * Level 2: Medium window (broader search)
 * Level 3: Wide window (maximum search)
 */
export type ValidationWindowLevel = 1 | 2 | 3;

// =============================================================================
// CORRELATION RESULT
// =============================================================================

/**
 * Cross-correlation result between findings from different gatherers
 */
export interface CorrelationResult {
	/** Overlap between log findings and code findings (file mentions) */
	logCodeOverlap: number;
	/** Overlap between code findings and change findings (touched files) */
	codeChangeOverlap: number;
	/** Time correlation between changes and log errors */
	changeTimeCorrelation: number;
	/** Weighted overall correlation score (0-100) */
	overallCorrelation: number;
}

/**
 * Zod schema for CorrelationResult
 */
export const CorrelationResultSchema = z.object({
	logCodeOverlap: z.number().min(0).max(100),
	codeChangeOverlap: z.number().min(0).max(100),
	changeTimeCorrelation: z.number().min(0).max(100),
	overallCorrelation: z.number().min(0).max(100),
});

// =============================================================================
// DATA QUALITY INFO
// =============================================================================

/**
 * Extended data quality with correlation info
 */
export interface DataQualityInfo {
	/** Incident context quality score */
	incident?: number;
	/** Alert data quality score */
	alerts?: number;
	/** Gathered findings quality score */
	gathered?: number;
	/** Pre-gathering quality score */
	preGathering?: number;
	/** Cross-correlation results */
	correlations?: CorrelationResult;
	/** Allow additional dynamic quality scores */
	[key: string]: number | CorrelationResult | undefined;
}

// =============================================================================
// HANDOFF REQUEST
// =============================================================================

/**
 * Canonical list of all handoff-capable agent names.
 * Includes orchestration agents (supervisor, gatherer-coordinator).
 */
export const HANDOFF_AGENT_NAMES = [
	...SUPERVISOR_AGENT_NAMES,
	"supervisor",
	"gatherer-coordinator",
] as const;

/**
 * All agents that can participate in handoffs.
 */
export type HandoffAgentName = (typeof HANDOFF_AGENT_NAMES)[number];

/**
 * Handoff request for agent-to-agent communication.
 * Generalized to support any-to-any handoffs with capability validation.
 */
export interface HandoffRequest {
	/** Agent initiating the handoff */
	from: HandoffAgentName;
	/** Target agent to invoke */
	to: HandoffAgentName;
	/** Why this handoff is needed */
	reason: string;
	/** Specific query or context for the target agent */
	context: string;
	/** Related todo ID if this handoff is task-driven */
	todoId?: string;
	/** Priority override for urgent handoffs */
	priority?: "normal" | "urgent";
}

/**
 * Zod schema for HandoffRequest validation.
 * Derives enum values from HANDOFF_AGENT_NAMES to stay in sync.
 */
export const HandoffRequestSchema = z.object({
	from: z.enum(HANDOFF_AGENT_NAMES),
	to: z.enum(HANDOFF_AGENT_NAMES),
	reason: z.string(),
	context: z.string(),
	todoId: z.string().optional(),
	priority: z.enum(["normal", "urgent"]).optional(),
});

// =============================================================================
// FIX
// =============================================================================

/**
 * Fix proposal from Surgeon agent
 */
export interface Fix {
	/** Type of fix */
	type: "code_change" | "config_change" | "rollback" | "monitoring";
	/** Human-readable summary */
	summary: string;
	/** Confidence in the fix (0-100) */
	confidence: number;
	/** Code changes if applicable */
	codeChanges?: Array<{
		filePath: string;
		searchBlock: string;
		replaceBlock: string;
		testCase: string;
	}>;
	/** Rollback target if applicable */
	rollbackTarget?: {
		service: string;
		version: string;
		reason: string;
	};
	/** Estimated effort */
	effort?: "minutes" | "hours" | "days";
}

/**
 * Zod schema for Fix validation
 */
export const FixSchema = z.object({
	type: z.enum(["code_change", "config_change", "rollback", "monitoring"]),
	summary: z.string(),
	confidence: z.number().min(0).max(100),
	codeChanges: z.array(z.object({
		filePath: z.string(),
		searchBlock: z.string(),
		replaceBlock: z.string(),
		testCase: z.string(),
	})).optional(),
	rollbackTarget: z.object({
		service: z.string(),
		version: z.string(),
		reason: z.string(),
	}).optional(),
	effort: z.enum(["minutes", "hours", "days"]).optional(),
});

// =============================================================================
// CLONE TYPES
// =============================================================================

/**
 * Clone decision for repository analysis
 */
export interface CloneDecision {
	clone: boolean;
	type?: "shallow" | "full";
	reason: string;
}

/**
 * Information about a cloned repository
 */
export interface ClonedRepoInfo {
	/** Service ID this repo belongs to */
	serviceId: string;
	/** Human-readable service name */
	serviceName?: string;
	/** Repository URL that was cloned */
	repoUrl: string;
	/** Local filesystem path to the cloned repo */
	clonePath: string;
	/** Type of clone performed */
	cloneType: "shallow" | "full";
	/** When the repo was cloned */
	timestamp: string;
}

// =============================================================================
// AGENT ERROR
// =============================================================================

/**
 * Agent error (non-blocking)
 */
export interface AgentError {
	agent: SupervisorAgentName;
	error: string;
	timestamp: string;
	recoverable: boolean;
}
