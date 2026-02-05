import { Injectable, Logger } from "@nestjs/common";
import {
	getCheckpoint,
	listCheckpoints,
	getStateFromCheckpoint,
	getCheckpointTimestamp,
	type InvestigationState,
	type InvestigationPhase,
	type AgentName,
	type GraphNodeId,
	getBestHypothesis,
} from "@prismalens/agents";
import type { SupervisorPhase } from "@prismalens/agents";
import type {
	InvestigationProgressType,
	ProgressSnapshotType,
	DataQualityInfoType,
	AgentExecutionRecordType,
	HandoffRecordType,
} from "@prismalens/contracts";

/**
 * Progress Service
 *
 * Provides investigation progress data by querying LangGraph checkpoints.
 * This exposes the rich state data from checkpoints for real-time UI visualization.
 */
@Injectable()
export class ProgressService {
	private readonly logger = new Logger(ProgressService.name);

	/**
	 * Get current progress of an investigation.
	 * Returns null if no checkpoint exists (investigation hasn't started).
	 */
	async getProgress(
		investigationId: string,
	): Promise<InvestigationProgressType | null> {
		const checkpoint = await getCheckpoint(investigationId);
		if (!checkpoint) {
			this.logger.debug(
				`No checkpoint found for investigation ${investigationId}`,
			);
			return null;
		}

		return this.mapCheckpointToProgress(investigationId, checkpoint);
	}

	/**
	 * Get progress history (all checkpoints) for an investigation.
	 * Useful for timeline reconstruction and debugging.
	 */
	async getProgressHistory(
		investigationId: string,
	): Promise<ProgressSnapshotType[]> {
		const checkpoints = await listCheckpoints(investigationId);
		return checkpoints.map((cp) => this.mapCheckpointToSnapshot(cp));
	}

	/**
	 * Map a LangGraph checkpoint to InvestigationProgress format.
	 */
	private mapCheckpointToProgress(
		investigationId: string,
		checkpoint: Awaited<ReturnType<typeof getCheckpoint>>,
	): InvestigationProgressType {
		// Extract state from checkpoint using type-safe helper
		const state = getStateFromCheckpoint<InvestigationState>(checkpoint);

		if (!state) {
			// Return minimal progress if state is not available
			return {
				investigationId,
				status: "pending",
				phase: "pre_gathering",
				currentNode: null,
				currentAgent: null,
				gatherIterations: 0,
				findings: 0,
				hypotheses: 0,
				confidence: null,
				handoffHistory: [],
				dataQuality: null,
				agentExecutions: [],
				updatedAt: new Date().toISOString(),
			};
		}

		// Get best hypothesis for confidence
		const bestHypothesis = getBestHypothesis(state);

		// Map status
		const status = this.mapStatus(state.status);

		// Map phase - convert SupervisorPhase to InvestigationPhase
		// SupervisorPhase doesn't include pre_gathering/challenging (those are inferred)
		const phase = this.mapPhase(state.phase, state.status, state.currentAgent);

		// Map current agent (currentAgent in state)
		const currentAgent = state.currentAgent as AgentName | null ?? null;

		// Determine current node from state
		const currentNode = this.determineCurrentNode(state);

		// Map handoff history
		const handoffHistory = this.mapHandoffHistory(state.handoffHistory ?? []);

		// Map data quality
		const dataQuality = state.dataQuality
			? this.mapDataQuality(state.dataQuality)
			: null;

		// Map agent executions
		const agentExecutions = this.mapAgentExecutions(
			state.agentExecutions ?? [],
		);

		// Get timestamp from checkpoint using type-safe helper
		const ts = getCheckpointTimestamp(checkpoint);
		const updatedAt = ts ?? new Date().toISOString();

		return {
			investigationId: state.investigationId ?? investigationId,
			status,
			phase,
			currentNode,
			currentAgent,
			gatherIterations: state.gatherIterations ?? 0,
			findings: state.findings?.length ?? 0,
			hypotheses: state.hypotheses?.length ?? 0,
			confidence: bestHypothesis?.confidence ?? null,
			handoffHistory,
			dataQuality,
			agentExecutions,
			updatedAt,
		};
	}

	/**
	 * Map a checkpoint to a snapshot for history/timeline.
	 */
	private mapCheckpointToSnapshot(
		checkpoint: Awaited<ReturnType<typeof listCheckpoints>>[number],
	): ProgressSnapshotType {
		// Use type-safe helpers to extract state and timestamp
		const state = getStateFromCheckpoint<InvestigationState>(checkpoint);
		const bestHypothesis = state ? getBestHypothesis(state) : null;
		const ts = getCheckpointTimestamp(checkpoint);

		return {
			timestamp: ts ?? new Date().toISOString(),
			phase: state
				? this.mapPhase(state.phase, state.status, state.currentAgent)
				: "pre_gathering",
			currentNode: state ? this.determineCurrentNode(state) : null,
			findings: state?.findings?.length ?? 0,
			hypotheses: state?.hypotheses?.length ?? 0,
			confidence: bestHypothesis?.confidence ?? null,
		};
	}

	/**
	 * Map investigation status string to typed status.
	 */
	private mapStatus(
		status: string | undefined,
	): InvestigationProgressType["status"] {
		switch (status) {
			case "pending":
				return "pending";
			case "validating":
				return "validating";
			case "running":
				return "running";
			case "completed":
				return "completed";
			case "failed":
				return "failed";
			default:
				return "pending";
		}
	}

	/**
	 * Map SupervisorPhase to InvestigationPhase.
	 * SupervisorPhase doesn't include pre_gathering or challenging.
	 * These are inferred from status and currentAgent.
	 */
	private mapPhase(
		phase: SupervisorPhase | undefined,
		status: string | undefined,
		currentAgent: string | undefined,
	): InvestigationPhase {
		// If status is pending/validating, we're in pre_gathering
		if (status === "pending" || status === "validating") {
			return "pre_gathering";
		}

		// If current agent is adversary, we're in challenging phase
		if (currentAgent === "adversary") {
			return "challenging";
		}

		// Otherwise, map SupervisorPhase directly
		switch (phase) {
			case "gathering":
				return "gathering";
			case "targeted_gather":
				return "targeted_gather";
			case "analyzing":
				return "analyzing";
			case "fixing":
				return "fixing";
			case "complete":
				return "complete";
			default:
				return "pre_gathering";
		}
	}

	/**
	 * Determine current node from state.
	 * This is inferred from phase and current agent.
	 */
	private determineCurrentNode(state: InvestigationState): GraphNodeId | null {
		// If there's a current agent, that's the current node
		if (state.currentAgent) {
			return state.currentAgent as GraphNodeId;
		}

		// Otherwise, infer from phase
		// Note: State uses SupervisorPhase which doesn't include pre_gathering/challenging
		// Those phases are inferred from status (pending/validating) or currentAgent (adversary)
		const phase = state.phase;
		switch (phase) {
			case "gathering":
				return "gatherer-coordinator";
			case "targeted_gather":
				return "gatherer-coordinator";
			case "analyzing":
				return "detective";
			case "fixing":
				return "surgeon";
			case "complete":
				return "writeToApi";
			default:
				return "supervisor";
		}
	}

	/**
	 * Map handoff history to contract type.
	 */
	private mapHandoffHistory(
		history: InvestigationState["handoffHistory"],
	): HandoffRecordType[] {
		if (!history) return [];

		return history.map((h) => ({
			id: h.id,
			traceId: h.traceId,
			from: h.from,
			to: h.to,
			reason: h.reason,
			context: h.context as Record<string, unknown> | undefined,
			status: h.status,
			denialReason: h.denialReason,
			requestedAt: h.requestedAt,
			dispatchedAt: h.dispatchedAt,
			completedAt: h.completedAt,
			resultSummary: h.resultSummary,
			findingsAdded: h.findingsAdded,
		}));
	}

	/**
	 * Map data quality to contract type.
	 */
	private mapDataQuality(
		quality: InvestigationState["dataQuality"],
	): DataQualityInfoType | null {
		if (!quality) return null;

		return {
			incident: quality.incident,
			alerts: quality.alerts,
			gathered: quality.gathered,
			preGathering: quality.preGathering,
			correlations: quality.correlations
				? {
						logCodeOverlap: quality.correlations.logCodeOverlap,
						codeChangeOverlap: quality.correlations.codeChangeOverlap,
						changeTimeCorrelation: quality.correlations.changeTimeCorrelation,
						overallCorrelation: quality.correlations.overallCorrelation,
					}
				: undefined,
		};
	}

	/**
	 * Map agent executions to contract type.
	 * Maps from AgentExecutionRecord (agents schema) to AgentExecutionRecordType (contracts schema).
	 */
	private mapAgentExecutions(
		executions: InvestigationState["agentExecutions"],
	): AgentExecutionRecordType[] {
		if (!executions) return [];

		return executions.map((exec) => ({
			// Map agentName to agentId (contracts use agentId)
			agentId: exec.agentName,
			startedAt: exec.startedAt ?? new Date().toISOString(),
			completedAt: exec.completedAt,
			// Map status (agents schema has "pending" but contracts only allow running/completed/failed)
			status: this.mapExecutionStatus(exec.status),
			// Map token fields (combine input+output tokens)
			tokensUsed:
				exec.inputTokens != null || exec.outputTokens != null
					? (exec.inputTokens ?? 0) + (exec.outputTokens ?? 0)
					: undefined,
			// Map toolExecutions count to toolCalls
			toolCalls: exec.toolExecutions?.length,
			findingsProduced: undefined, // Not available in agents schema
			error: exec.error,
		}));
	}

	/**
	 * Map execution status from agents schema to contracts schema.
	 * Agents schema includes "pending" but contracts only allow running/completed/failed.
	 */
	private mapExecutionStatus(
		status: "pending" | "running" | "completed" | "failed",
	): "running" | "completed" | "failed" {
		if (status === "pending") {
			return "running"; // Treat pending as running for UI
		}
		return status;
	}
}
