/**
 * Tracing Utilities for LangSmith
 *
 * Provides dynamic trace configuration for LangGraph nodes.
 * All trace metadata is derived from InvestigationState at runtime.
 *
 * Features:
 * - Custom run names derived from state context
 * - Tags for filtering (phase, agent type, investigation)
 * - Metadata for debugging (findings count, confidence, etc.)
 */

import type { RunnableConfig } from "@langchain/core/runnables";
import type {
	InvestigationState,
	SupervisorAgentName,
} from "../types/index.js";

// =============================================================================
// TYPES
// =============================================================================

export interface TraceConfig {
	runName: string;
	tags: string[];
	metadata: Record<string, unknown>;
}

// =============================================================================
// AGENT TYPE CLASSIFICATION
// =============================================================================

/**
 * Agent type classification using SupervisorAgentName type.
 * Type-safe: Adding a new agent to the type will flag missing classification.
 */
const GATHERER_AGENTS: Set<SupervisorAgentName> = new Set([
	"log-gatherer",
	"code-searcher",
	"change-tracker",
]);

const ANALYZER_AGENTS: Set<SupervisorAgentName> = new Set([
	"detective",
	"adversary",
]);

const FIXER_AGENTS: Set<SupervisorAgentName> = new Set(["surgeon"]);

/**
 * Infer agent type from agent name.
 * Returns undefined for unknown agents (allows graceful degradation).
 */
function inferAgentType(agentName: SupervisorAgentName): string | undefined {
	if (GATHERER_AGENTS.has(agentName)) return "gatherer";
	if (ANALYZER_AGENTS.has(agentName)) return "analyzer";
	if (FIXER_AGENTS.has(agentName)) return "fixer";
	return undefined;
}

// =============================================================================
// TRACE CONFIG BUILDER
// =============================================================================

/**
 * Build trace config dynamically from state.
 * All values derived from InvestigationState - nothing hardcoded.
 *
 * @param state - Current investigation state
 * @param contextOverride - Optional explicit context string for run name
 * @returns TraceConfig with runName, tags, and metadata
 *
 * @example
 * const traceConfig = buildTraceConfig(state);
 * // runName: "Detective: Analyze"
 * // tags: ["prismalens", "inv:abc123", "phase:gathering", "agent-type:analyzer"]
 * // metadata: { investigationId: "abc123", findingsCount: 5, ... }
 */
export function buildTraceConfig(
	state: InvestigationState,
	contextOverride?: string,
): TraceConfig {
	return {
		runName: buildRunName(state, contextOverride),
		tags: buildTags(state),
		metadata: buildMetadata(state),
	};
}

// =============================================================================
// RUN NAME BUILDER
// =============================================================================

/**
 * Build descriptive run name from state context.
 * Derives context dynamically from state fields.
 */
function buildRunName(
	state: InvestigationState,
	contextOverride?: string,
): string {
	const { currentAgent, phase, finalAnalysisOnly, handoffRequest, fix } = state;

	// If explicit context provided, use it
	if (contextOverride && currentAgent) {
		return `${formatAgentName(currentAgent)}: ${contextOverride}`;
	}

	// No current agent - show phase
	if (!currentAgent) {
		return `Phase: ${phase}`;
	}

	// Derive context based on agent and state
	let context: string | undefined;

	switch (currentAgent) {
		case "detective":
			context = finalAnalysisOnly
				? "Final Analysis"
				: handoffRequest
					? `Request: ${handoffRequest.to}`
					: "Analyze";
			break;

		case "surgeon":
			context = fix?.type ? fix.type.replace(/_/g, " ") : "Propose Fix";
			break;

		case "adversary": {
			const bestConf = state.hypotheses.length > 0
				? Math.max(...state.hypotheses.map((h) => h.confidence))
				: 0;
			context = bestConf > 0 ? `Challenge ${bestConf}%` : "Challenge";
			break;
		}

		default:
			// Gatherers - use handoff context if available
			if (handoffRequest?.to === currentAgent) {
				context = truncate(handoffRequest.context, 30);
			}
	}

	const name = formatAgentName(currentAgent);
	return context ? `${name}: ${context}` : name;
}

// =============================================================================
// TAG BUILDER
// =============================================================================

/**
 * Build tags dynamically from state.
 * Tags enable filtering in LangSmith UI.
 */
function buildTags(state: InvestigationState): string[] {
	const tags = [
		"prismalens",
		`inv:${state.investigationId}`,
		`phase:${state.phase}`,
	];

	// Add agent-specific tags
	if (state.currentAgent) {
		tags.push(`node:${state.currentAgent}`);

		const agentType = inferAgentType(state.currentAgent);
		if (agentType) {
			tags.push(`agent-type:${agentType}`);
		}
	}

	// Add iteration tag if in gather cycle
	if (state.gatherIterations > 0) {
		tags.push(`iteration:${state.gatherIterations}`);
	}

	// Add handoff tag if processing handoff
	if (state.handoffRequest) {
		tags.push(`handoff:${state.handoffRequest.to}`);
	}

	// Add final analysis tag
	if (state.finalAnalysisOnly) {
		tags.push("final-analysis");
	}

	return tags;
}

// =============================================================================
// METADATA BUILDER
// =============================================================================

/**
 * Build metadata from state.
 * Metadata appears in LangSmith run details panel.
 */
function buildMetadata(state: InvestigationState): Record<string, unknown> {
	const metadata: Record<string, unknown> = {
		investigationId: state.investigationId,
		incidentId: state.incidentId,
		phase: state.phase,
		findingsCount: state.findings.length,
		hypothesesCount: state.hypotheses.length,
		gatherIterations: state.gatherIterations,
	};

	// Add confidence if hypotheses exist
	if (state.hypotheses.length > 0) {
		metadata.bestConfidence = Math.max(
			...state.hypotheses.map((h) => h.confidence),
		);
	}

	// Add handoff context
	if (state.handoffRequest) {
		metadata.handoffTarget = state.handoffRequest.to;
		metadata.handoffReason = state.handoffRequest.reason;
	}

	// Add handoff history stats
	if (state.handoffHistory.length > 0) {
		metadata.handoffCount = state.handoffHistory.length;
		metadata.deniedCount = state.handoffHistory.filter(
			(h) => h.status === "denied",
		).length;
	}

	// Add agent errors if any
	if (state.agentErrors.length > 0) {
		metadata.errorCount = state.agentErrors.length;
	}

	return metadata;
}

// =============================================================================
// CONFIG MERGER
// =============================================================================

/**
 * Merge trace config into RunnableConfig.
 * Preserves existing config values while adding trace configuration.
 *
 * @param baseConfig - Existing RunnableConfig (may be undefined)
 * @param traceConfig - TraceConfig to merge
 * @returns Merged RunnableConfig
 *
 * @example
 * const traceConfig = buildTraceConfig(state);
 * const mergedConfig = mergeTraceConfig(config, traceConfig);
 * await agent.invoke(input, mergedConfig);
 */
export function mergeTraceConfig(
	baseConfig: RunnableConfig | undefined,
	traceConfig: TraceConfig,
): RunnableConfig {
	return {
		...baseConfig,
		runName: traceConfig.runName,
		tags: [...(baseConfig?.tags || []), ...traceConfig.tags],
		metadata: { ...baseConfig?.metadata, ...traceConfig.metadata },
	};
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Format agent name for display.
 * Converts "log-gatherer" to "LogGatherer"
 */
function formatAgentName(name: SupervisorAgentName): string {
	return name
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join("");
}

/**
 * Truncate string with ellipsis.
 */
function truncate(str: string, len: number): string {
	if (str.length <= len) return str;
	return str.slice(0, len - 3) + "...";
}
