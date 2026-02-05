import { Controller, UseGuards } from "@nestjs/common";
import { Implement, implement, ORPCError } from "@orpc/nest";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { AgentExecution, Investigation, Recommendation, ToolExecution } from "@prismalens/database";
import { investigationsContract } from "@prismalens/contracts";
import { QueueService } from "../../infrastructure/queue/queue.service.js";
import type { InternalInvestigationResultDto } from "../../infrastructure/internal/dto/investigation-result.dto.js";
import { type InvestigationWithRelations, InvestigationsService } from "./investigations.service.js";
import { ProgressService } from "./progress.service.js";

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

					if (!investigation && !jobStatus) {
						throw new ORPCError("NOT_FOUND", {
							message: `Investigation ${input.id} not found`,
						});
					}

					return {
						investigation: investigation
							? this.serializeInvestigationWithRelations(investigation)
							: null,
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
						status: input.status,
						incidentId: investigation.incidentId,
						summary: input.summary,
						rootCause: input.rootCause,
						rootCauseCategory: input.rootCauseCategory,
						confidence: input.confidence,
						dataQuality: input.dataQuality,
						agentProgression: input.agentProgression,
						dataSourcesUsed: input.dataSourcesUsed,
						analysisMethod: input.analysisMethod,
						rawOutput: input.rawOutput,
						error: input.error,
						agentExecutions: input.agentExecutions,
						recommendations: input.recommendations,
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
			...investigation,
			summary: investigation.summary ?? null,
			rootCause: investigation.rootCause ?? null,
			impact: (investigation as Record<string, unknown>).impact ?? null,
			findings: investigation.findings
				? JSON.parse(investigation.findings as string)
				: null,
			startedAt: investigation.startedAt?.toISOString() ?? null,
			completedAt: investigation.completedAt?.toISOString() ?? null,
			createdAt: investigation.createdAt?.toISOString(),
			updatedAt: investigation.updatedAt?.toISOString(),
		};
	}

	private serializeInvestigationWithRelations(investigation: InvestigationWithRelations) {
		const serialized = this.serializeInvestigation(investigation);

		if (investigation.incident) {
			serialized.incident = {
				id: investigation.incident.id,
				number: investigation.incident.number,
				title: investigation.incident.title,
				status: investigation.incident.status,
				severity: investigation.incident.severity,
			};
		}

		if (investigation.recommendations) {
			serialized.recommendations = investigation.recommendations.map(
				(r: Recommendation) => ({
					id: r.id,
					title: r.title,
					priority: r.priority,
					status: r.status,
				}),
			);
		}

		return serialized;
	}

	private serializeAgentExecution(execution: AgentExecution & { toolExecutions: ToolExecution[] }) {
		return {
			...execution,
			input: execution.input ? JSON.parse(execution.input) : null,
			output: execution.output ? JSON.parse(execution.output) : null,
			error: execution.error ?? null,
			startedAt: execution.startedAt?.toISOString(),
			completedAt: execution.completedAt?.toISOString() ?? null,
			tools: execution.toolExecutions?.map((t: ToolExecution) => ({
				...t,
				input: t.input ? JSON.parse(t.input) : null,
				output: t.output ? JSON.parse(t.output) : null,
				error: t.error ?? null,
				startedAt: t.startedAt?.toISOString(),
				completedAt: t.completedAt?.toISOString() ?? null,
			})),
		};
	}
}
