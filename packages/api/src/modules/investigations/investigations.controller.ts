import { Controller, UseGuards } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { AgentExecution, Investigation, Recommendation, ToolExecution } from "@prismalens/database";
import { investigationsContract } from "@prismalens/contracts";
import type { WorkflowStatus, RootCauseCategory, AgentName, AgentType as ContractAgentType, ExecutionStatus, ToolExecutionStatus, ToolCategory } from "@prismalens/contracts";
import { QueueService } from "../../infrastructure/queue/queue.service.js";
import type { InternalInvestigationResultDto } from "../../infrastructure/internal/dto/investigation-result.dto.js";
import type { WorkflowStatus as DtoWorkflowStatus, RootCauseCategory as DtoRootCauseCategory } from "../../shared/enums/index.js";
import type { AgentExecutionDto } from "../../infrastructure/internal/dto/agent-execution.dto.js";
import type { RecommendationDto } from "../../infrastructure/internal/dto/recommendation.dto.js";
import { type InvestigationWithRelations, InvestigationsService } from "./investigations.service.js";
import { ProgressService } from "./progress.service.js";
import { safeParseJsonObject, safeParseJsonArray } from "../../shared/utils/json-utils.js";

@Controller()
@UseGuards(ThrottlerGuard)
export class InvestigationsController {
	constructor(
		private readonly investigationsService: InvestigationsService,
		private readonly queueService: QueueService,
		private readonly progressService: ProgressService,
	) {}

	@Implement(investigationsContract)
	investigations() {
		return {
			// POST /investigations - Create a new investigation
			create: implement(investigationsContract.create).handler(
				async ({ input }) => {
					const investigation = await this.investigationsService.create(input);
					return this.serializeInvestigation(investigation);
				},
			),

			// GET /investigations - List investigations with filtering
			list: implement(investigationsContract.list).handler(
				async ({ input }) => {
					const investigations = await this.investigationsService.findAll({
						status: input.status,
						limit: input.limit,
						offset: input.offset,
					});
					return investigations.map((i) =>
						this.serializeInvestigationWithRelations(i),
					);
				},
			),

			// GET /investigations/:id - Get a single investigation
			get: implement(investigationsContract.get).handler(async ({ input }) => {
				const investigation = await this.investigationsService.findById(
					input.id,
				);
				if (!investigation) {
					throw new ORPCError("NOT_FOUND", {
						message: `Investigation ${input.id} not found`,
					});
				}
				return this.serializeInvestigationWithRelations(investigation);
			}),

			// GET /investigations/:id/status - Get investigation status with job info
			getStatus: implement(investigationsContract.getStatus).handler(
				async ({ input }) => {
					const investigation = await this.investigationsService.findById(
						input.id,
					);
					const jobId = `investigation-${input.id}`;
					const jobStatus = await this.queueService.getJobStatus(jobId);

					if (!investigation) {
						throw new ORPCError("NOT_FOUND", {
							message: `Investigation ${input.id} not found`,
						});
					}

					return {
						investigation: this.serializeInvestigation(investigation),
						job: jobStatus
							? {
									id: jobId,
									state: jobStatus.status,
									progress: jobStatus.progress ?? null,
									attemptsMade: 0,
									failedReason: null,
								}
							: null,
					};
				},
			),

			// GET /investigations/:id/agents - Get agent executions
			getAgentExecutions: implement(
				investigationsContract.getAgentExecutions,
			).handler(async ({ input }) => {
				const investigation = await this.investigationsService.findById(
					input.id,
				);
				if (!investigation) {
					throw new ORPCError("NOT_FOUND", {
						message: `Investigation ${input.id} not found`,
					});
				}

				const executions = await this.investigationsService.getAgentExecutions(
					input.id,
				);
				return executions.map((e) => this.serializeAgentExecution(e));
			}),

			// POST /investigations/:id/cancel - Cancel an investigation
			cancel: implement(investigationsContract.cancel).handler(
				async ({ input }) => {
					// Mark investigation as cancelled by updating status
					const investigation = await this.investigationsService.findById(
						input.id,
					);
					if (!investigation) {
						throw new ORPCError("NOT_FOUND", {
							message: `Investigation ${input.id} not found`,
						});
					}
					// Update status to cancelled
					const updated = await this.investigationsService.updateStatus(
						input.id,
						"cancelled",
					);
					return this.serializeInvestigation(updated || investigation);
				},
			),

			// PATCH /investigations/:id/status - Update status (Worker)
			updateStatus: implement(investigationsContract.updateStatus).handler(
				async ({ input }) => {
					const investigation = await this.investigationsService.findById(
						input.id,
					);
					if (!investigation) {
						throw new ORPCError("NOT_FOUND", {
							message: `Investigation ${input.id} not found`,
						});
					}
					const updated = await this.investigationsService.updateStatusInternal(
						input.id,
						input.status,
						undefined,
						input.error,
					);
					return this.serializeInvestigation(updated || investigation);
				},
			),

			// POST /investigations/:id/result - Write result (Worker)
			writeResult: implement(investigationsContract.writeResult).handler(
				async ({ input }) => {
					const investigation = await this.investigationsService.findById(
						input.id,
					);
					if (!investigation) {
						throw new ORPCError("NOT_FOUND", {
							message: `Investigation ${input.id} not found`,
						});
					}

					// Map input to InternalInvestigationResultDto structure
					// Note: The input is already validated by Zod schema in contract
					const resultDto: InternalInvestigationResultDto = {
						status: input.status as DtoWorkflowStatus.COMPLETED | DtoWorkflowStatus.FAILED,
						incidentId: investigation.incidentId,
						summary: input.summary,
						rootCause: input.rootCause,
						rootCauseCategory: input.rootCauseCategory as DtoRootCauseCategory | undefined,
						confidence: input.confidence,
						dataQuality: input.dataQuality as Record<string, number> | undefined,
						agentProgression: input.agentProgression as Record<string, boolean> | undefined,
						dataSourcesUsed: input.dataSourcesUsed,
						analysisMethod: input.analysisMethod,
						rawOutput: input.rawOutput,
						error: input.error,
						agentExecutions: input.agentExecutions as AgentExecutionDto[] | undefined,
						recommendations: input.recommendations as RecommendationDto[] | undefined,
					};

					const updated =
						await this.investigationsService.writeResultWithRelations(
							input.id,
							resultDto,
						);
					return this.serializeInvestigationWithRelations(
						updated || investigation,
					);
				},
			),

			// GET /investigations/:id/progress - Get real-time progress from checkpoints
			getProgress: implement(investigationsContract.getProgress).handler(
				async ({ input }) => {
					return this.progressService.getProgress(input.id);
				},
			),

			// GET /investigations/:id/progress/history - Get progress history
			getProgressHistory: implement(
				investigationsContract.getProgressHistory,
			).handler(async ({ input }) => {
				return this.progressService.getProgressHistory(input.id);
			}),
		};
	}

	private serializeInvestigation(investigation: Investigation) {
		return {
			id: investigation.id,
			incidentId: investigation.incidentId,
			status: investigation.status as WorkflowStatus,
			startedAt: investigation.startedAt?.toISOString() ?? null,
			completedAt: investigation.completedAt?.toISOString() ?? null,
			summary: investigation.summary ?? null,
			rootCause: investigation.rootCause ?? null,
			rootCauseCategory: (investigation.rootCauseCategory as RootCauseCategory | null) ?? null,
			confidence: investigation.confidence ?? null,
			dataQuality: safeParseJsonObject(investigation.dataQuality) ?? null,
			analysisMethod: investigation.analysisMethod ?? null,
			dataSourcesUsed: safeParseJsonArray(investigation.dataSourcesUsed) ?? null,
			rawOutput: safeParseJsonObject(investigation.rawOutput) ?? null,
			error: investigation.error ?? null,
			agentProgression: safeParseJsonObject(investigation.agentProgression) ?? null,
			createdAt: investigation.createdAt.toISOString(),
			updatedAt: investigation.updatedAt.toISOString(),
		};
	}

	private serializeInvestigationWithRelations(investigation: InvestigationWithRelations) {
		const base = this.serializeInvestigation(investigation);

		return {
			...base,
			agentExecutions: investigation.agentExecutions
				? investigation.agentExecutions.map((e) => this.serializeAgentExecution(e))
				: undefined,
			recommendations: investigation.recommendations
				? investigation.recommendations.map((r: Recommendation) => ({
						id: r.id,
						title: r.title,
						priority: r.priority,
						status: r.status,
					}))
				: undefined,
		};
	}

	private serializeAgentExecution(execution: AgentExecution & { toolExecutions: ToolExecution[] }) {
		return {
			id: execution.id,
			investigationId: execution.investigationId,
			agentName: execution.agentName as AgentName,
			agentType: execution.agentType as ContractAgentType,
			status: execution.status as ExecutionStatus,
			startedAt: execution.startedAt?.toISOString() ?? null,
			completedAt: execution.completedAt?.toISOString() ?? null,
			executionTimeMs: execution.executionTimeMs ?? null,
			output: safeParseJsonObject(execution.output) ?? null,
			confidence: execution.confidence ?? null,
			inputTokens: execution.inputTokens ?? null,
			outputTokens: execution.outputTokens ?? null,
			error: execution.error ?? null,
			createdAt: execution.createdAt.toISOString(),
			toolExecutions: execution.toolExecutions?.map((t: ToolExecution) => ({
				id: t.id,
				agentExecutionId: t.agentExecutionId,
				toolName: t.toolName,
				toolCategory: (t.toolCategory as ToolCategory | null) ?? null,
				arguments: safeParseJsonObject(t.arguments) ?? null,
				result: safeParseJsonObject(t.result) ?? null,
				status: t.status as ToolExecutionStatus,
				executionTimeMs: t.executionTimeMs ?? null,
				confidence: t.confidence ?? null,
				dataQuality: t.dataQuality ?? null,
				error: t.error ?? null,
				executedAt: t.executedAt.toISOString(),
			})),
		};
	}
}
