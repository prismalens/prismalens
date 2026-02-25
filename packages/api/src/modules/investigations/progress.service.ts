import { Injectable, Logger } from "@nestjs/common";
import {
	getCheckpoint,
	listCheckpoints,
	getStateFromCheckpoint,
	getCheckpointTimestamp,
	type InvestigationState,
	getBestHypothesis,
} from "@prismalens/agents";
import type {
	InvestigationProgressType,
	ProgressSnapshotType,
	DataQualityInfoType,
	AgentExecutionRecordType,
	HandoffRecordType,
} from "@prismalens/contracts";
import { CheckpointerProvider } from "../../core/checkpointer/checkpointer.provider.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";

/**
 * Extended checkpoint state that may include fields populated at runtime
 * by the supervisor but not declared on the base InvestigationState interface.
 */
interface CheckpointState extends InvestigationState {
	status?: string;
	currentAgent?: string;
	gatherIterations?: number;
	findings?: unknown[];
	handoffHistory?: {
		id: string;
		traceId?: string;
		from: string;
		to: string;
		reason: string;
		context?: Record<string, unknown>;
		status: "pending" | "dispatched" | "denied" | "completed" | "failed";
		denialReason?: string;
		requestedAt: string;
		dispatchedAt?: string;
		completedAt?: string;
		resultSummary?: string;
		findingsAdded?: number;
	}[];
	dataQuality?: {
		incident?: number;
		alerts?: number;
		gathered?: number;
		correlations?: {
			logCodeOverlap: number;
			codeChangeOverlap: number;
			changeTimeCorrelation: number;
			overallCorrelation: number;
		};
	};
	agentExecutions?: {
		agentName: string;
		startedAt?: string;
		completedAt?: string;
		status: "pending" | "running" | "completed" | "failed";
		inputTokens?: number;
		outputTokens?: number;
		toolExecutions?: unknown[];
		error?: string;
	}[];
}

/**
 * Progress Service
 *
 * Provides investigation progress data by querying LangGraph checkpoints.
 * This exposes the rich state data from checkpoints for real-time UI visualization.
 */
@Injectable()
export class ProgressService {
	private readonly logger = new Logger(ProgressService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly checkpointerProvider: CheckpointerProvider,
	) {}

	/**
	 * Get current progress of an investigation.
	 * Returns null if no checkpoint exists (investigation hasn't started).
	 */
	async getProgress(
		investigationId: string,
	): Promise<InvestigationProgressType | null> {
		const checkpointer = this.checkpointerProvider.get();
		const threadId = await this.getThreadId(investigationId);
		if (!threadId || !checkpointer) {
			this.logger.debug(
				`No checkpoint available for investigation ${investigationId}`,
			);
			return null;
		}

		const checkpoint = await getCheckpoint(checkpointer, threadId);
		if (!checkpoint) {
			this.logger.debug(
				`No checkpoint found for investigation ${investigationId} (thread ${threadId})`,
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
		const checkpointer = this.checkpointerProvider.get();
		const threadId = await this.getThreadId(investigationId);
		if (!threadId || !checkpointer) return [];

		const checkpoints = await listCheckpoints(checkpointer, threadId);
		return Promise.all(
			checkpoints.map((cp) => this.mapCheckpointToSnapshot(cp)),
		);
	}

	/**
	 * Look up the LangGraph thread ID for an investigation.
	 */
	private async getThreadId(investigationId: string): Promise<string | null> {
		const investigation = await this.prisma.investigation.findUnique({
			where: { id: investigationId },
			select: { langGraphThreadId: true },
		});
		return investigation?.langGraphThreadId ?? null;
	}

	/**
	 * Map a LangGraph checkpoint to InvestigationProgress format.
	 */
	private async mapCheckpointToProgress(
		investigationId: string,
		checkpoint: NonNullable<Awaited<ReturnType<typeof getCheckpoint>>>,
	): Promise<InvestigationProgressType> {
		const state = getStateFromCheckpoint<CheckpointState>(checkpoint);

		if (!state) {
			return {
				investigationId,
				status: "pending",
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

		const bestHypothesis = getBestHypothesis(state);
		const status = this.mapStatus(state.status);
		const currentAgent = (state.currentAgent as string | null) ?? null;
		const currentNode = this.determineCurrentNode(state);
		const handoffHistory = this.mapHandoffHistory(state.handoffHistory ?? []);
		const dataQuality = state.dataQuality
			? this.mapDataQuality(state.dataQuality)
			: null;
		const agentExecutions = this.mapAgentExecutions(
			state.agentExecutions ?? [],
		);
		const ts = getCheckpointTimestamp(checkpoint);
		const updatedAt = ts ?? new Date().toISOString();

		return {
			investigationId: state.investigationId ?? investigationId,
			status,
			currentNode: currentNode as InvestigationProgressType["currentNode"],
			currentAgent: currentAgent as InvestigationProgressType["currentAgent"],
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
		checkpoint: NonNullable<Awaited<ReturnType<typeof getCheckpoint>>>,
	): ProgressSnapshotType {
		const state = getStateFromCheckpoint<CheckpointState>(checkpoint);
		const bestHypothesis = state ? getBestHypothesis(state) : null;
		const ts = getCheckpointTimestamp(checkpoint);

		return {
			timestamp: ts ?? new Date().toISOString(),
			currentNode: (state
				? this.determineCurrentNode(state)
				: null) as ProgressSnapshotType["currentNode"],
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
	 * Determine current node from state.
	 * Returns the current agent name, or "supervisor" as fallback.
	 */
	private determineCurrentNode(state: CheckpointState): string | null {
		return state.currentAgent ?? "supervisor";
	}

	/**
	 * Map handoff history to contract type.
	 */
	private mapHandoffHistory(
		history: NonNullable<CheckpointState["handoffHistory"]>,
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
		quality: NonNullable<CheckpointState["dataQuality"]>,
	): DataQualityInfoType | null {
		if (!quality) return null;

		return {
			incident: quality.incident,
			alerts: quality.alerts,
			gathered: quality.gathered,
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
	 */
	private mapAgentExecutions(
		executions: NonNullable<CheckpointState["agentExecutions"]>,
	): AgentExecutionRecordType[] {
		if (!executions) return [];

		return executions.map((exec) => ({
			agentId: exec.agentName,
			startedAt: exec.startedAt ?? new Date().toISOString(),
			completedAt: exec.completedAt,
			status: this.mapExecutionStatus(exec.status),
			tokensUsed:
				exec.inputTokens != null || exec.outputTokens != null
					? (exec.inputTokens ?? 0) + (exec.outputTokens ?? 0)
					: undefined,
			toolCalls: exec.toolExecutions?.length,
			findingsProduced: undefined,
			error: exec.error,
		}));
	}

	/**
	 * Map execution status from agents schema to contracts schema.
	 */
	private mapExecutionStatus(
		status: "pending" | "running" | "completed" | "failed",
	): "running" | "completed" | "failed" {
		if (status === "pending") {
			return "running";
		}
		return status;
	}
}
