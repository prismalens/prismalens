// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { setTimeout } from "node:timers/promises";
import { Controller, UseGuards } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Implement, implement, ORPCError } from "@orpc/nest";
import type {
	AgentName,
	AgentType as ContractAgentType,
	ExecutionStatus,
	InvestigationReport,
	RootCauseCategory,
	ToolCategory,
	ToolExecutionStatus,
	WorkflowStatus,
} from "@prismalens/contracts";
import { investigationsContract, OverlaySchema } from "@prismalens/contracts";
import type {
	AgentExecution,
	Investigation,
	Recommendation,
	ToolExecution,
} from "@prismalens/database";
import { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import type { AgentExecutionDto } from "../../infrastructure/internal/dto/agent-execution.dto.js";
import type { InternalInvestigationResultDto } from "../../infrastructure/internal/dto/investigation-result.dto.js";
import type { RecommendationDto } from "../../infrastructure/internal/dto/recommendation.dto.js";
import type { RootCauseCategory as DtoRootCauseCategory } from "../../shared/enums/index.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import {
	InvestigationsService,
	type InvestigationWithRelations,
} from "./investigations.service.js";

/** Statuses a run cannot be cancelled from — it has already stopped. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
	"completed",
	"failed",
	"cancelled",
]);

/**
 * Grace between cancel-publish retries: long enough for a worker that just locked
 * the job to reach its cancel subscribe (milliseconds after lock), short enough
 * that the cancel request stays interactive.
 */
const CANCEL_PUBLISH_RETRY_MS = 250;

@Controller()
@UseGuards(ThrottlerGuard)
export class InvestigationsController {
	constructor(
		private readonly investigationsService: InvestigationsService,
		private readonly dispatchService: DispatchService,
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
					const { data, total } = await this.investigationsService.findAll({
						status: input.status,
						limit: input.limit,
						offset: input.offset,
					});
					const limit = input.limit;
					const offset = input.offset;
					return {
						data: data.map((i) => this.serializeInvestigationWithRelations(i)),
						pagination: {
							total,
							limit,
							offset,
							hasMore: offset + data.length < total,
						},
					};
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
					const jobStatus = await this.dispatchService.getJobStatus(input.id);

					if (!investigation) {
						throw new ORPCError("NOT_FOUND", {
							message: `Investigation ${input.id} not found`,
						});
					}

					return {
						investigation: this.serializeInvestigation(investigation),
						job: jobStatus
							? {
									id: jobStatus.id,
									state: jobStatus.status,
									// The JobStore records attempts and outcomes, not a progress
									// percentage — the durable event record is the progress surface.
									progress: null,
									attemptsMade: jobStatus.attempts,
									failedReason: jobStatus.error,
								}
							: null,
					};
				},
			),

			// GET /investigations/:id/events - Durable canonical event record (replay)
			getEvents: implement(investigationsContract.getEvents).handler(
				async ({ input }) => {
					const investigation = await this.investigationsService.findById(
						input.id,
					);
					if (!investigation) {
						throw new ORPCError("NOT_FOUND", {
							message: `Investigation ${input.id} not found`,
						});
					}
					return this.investigationsService.getEvents(
						input.id,
						input.cursor,
						input.limit,
					);
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

			// POST /investigations/:id/cancel - Request cancellation of a run.
			// Two terminal-write owners (CANCEL slice, ADR-0018), by run state:
			//   - RUNNING: publish on the run's EventBus cancel topic. The dispatch loop
			//     that holds the claim forwards it to the run's child, which aborts, tears
			//     down the harness/sandbox, and owns the terminal "cancelled" write. The
			//     bus has no retention, so the publish is only a cancel if someone RECEIVED
			//     it — zero receivers after the grace retries means nobody holds the run
			//     (a crashed child, a stuck record) and nobody else will ever write the
			//     terminal state, so the API writes it here. A run that somehow still
			//     finishes later is blocked by the cancelled-is-sticky rule in the status
			//     writers.
			//   - PENDING (unclaimed): nothing is subscribed yet — cancel the job row
			//     directly and write the terminal "cancelled" record HERE. If the row was
			//     already claimed (a dispatcher won the race), fall through to the publish
			//     path; the grace retries cover the claim→subscribe window.
			cancel: implement(investigationsContract.cancel).handler(
				async ({ input }) => {
					const investigation = await this.investigationsService.findById(
						input.id,
					);
					if (!investigation) {
						throw new ORPCError("NOT_FOUND", {
							message: `Investigation ${input.id} not found`,
						});
					}
					// Reject cancel for a run that already reached a terminal state — there
					// is nothing to stop, and a stale cancel must not resurrect/relabel it.
					if (TERMINAL_STATUSES.has(investigation.status)) {
						throw new ORPCError("CONFLICT", {
							message: `Investigation ${input.id} is already ${investigation.status}`,
						});
					}
					if (investigation.status === "pending") {
						const cancelledJob = await this.dispatchService.cancelPendingJob(
							input.id,
						);
						if (cancelledJob) {
							const cancelled = await this.investigationsService.cancelPending(
								input.id,
								investigation.incidentId,
							);
							return this.serializeInvestigation(cancelled ?? investigation);
						}
						// Lost the race — a dispatcher claimed the job. Fall through to publish
						// so the run that holds it owns the terminal write.
					}
					let receivers = await this.dispatchService.requestCancel(input.id);
					for (let attempt = 0; receivers === 0 && attempt < 2; attempt++) {
						await setTimeout(CANCEL_PUBLISH_RETRY_MS);
						receivers = await this.dispatchService.requestCancel(input.id);
					}
					if (receivers === 0) {
						const cancelled = await this.investigationsService.cancelPending(
							input.id,
							investigation.incidentId,
							"The investigation was cancelled; no run held it.",
						);
						return this.serializeInvestigation(cancelled ?? investigation);
					}
					// The run heard the cancel; return the still-running investigation
					// unchanged — the terminal "cancelled" state arrives from the run + the
					// SSE stream's terminal event (the UI refetches on completion).
					return this.serializeInvestigation(investigation);
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
						input.harnessThreadId,
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
						status: input.status as "completed" | "failed",
						incidentId: investigation.incidentId,
						summary: input.summary,
						rootCause: input.rootCause,
						rootCauseCategory: input.rootCauseCategory as
							| DtoRootCauseCategory
							| undefined,
						report: input.report,
						error: input.error,
						agentExecutions: input.agentExecutions as
							| AgentExecutionDto[]
							| undefined,
						recommendations: input.recommendations as
							| RecommendationDto[]
							| undefined,
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
		};
	}

	private parseOverlay(raw: Investigation["overlay"]) {
		const obj = safeParseJsonObject(raw);
		if (!obj) return null;
		const parsed = OverlaySchema.safeParse(obj);
		return parsed.success ? parsed.data : null;
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
			rootCauseCategory:
				(investigation.rootCauseCategory as RootCauseCategory | null) ?? null,
			report:
				(safeParseJsonObject(
					investigation.report,
				) as InvestigationReport | null) ?? null,
			// Reduce overlay (ADR-0016 §5c) — parsed through OverlaySchema so a
			// malformed/absent blob degrades to null rather than corrupting the payload.
			overlay: this.parseOverlay(investigation.overlay),
			error: investigation.error ?? null,
			createdAt: investigation.createdAt.toISOString(),
			updatedAt: investigation.updatedAt.toISOString(),
		};
	}

	private serializeInvestigationWithRelations(
		investigation: InvestigationWithRelations,
	) {
		const base = this.serializeInvestigation(investigation);

		return {
			...base,
			agentExecutions: investigation.agentExecutions
				? investigation.agentExecutions.map((e) =>
						this.serializeAgentExecution(e),
					)
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

	private serializeAgentExecution(
		execution: AgentExecution & { toolExecutions: ToolExecution[] },
	) {
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
				dataQuality: t.dataQuality ?? null,
				error: t.error ?? null,
				executedAt: t.executedAt.toISOString(),
			})),
		};
	}
}
