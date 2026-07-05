import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import type {
	AgentExecution,
	Investigation,
	Recommendation,
	ToolExecution,
} from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import type { InternalInvestigationResultDto } from "../../infrastructure/internal/dto/investigation-result.dto.js";
import { TimelineEntryType, TimelineSource } from "../../shared/enums/index.js";
import { OverlayService } from "../overlay/overlay.service.js";
import { TimelineService } from "../timeline/timeline.service.js";
import {
	CreateAgentExecutionDto,
	CreateInvestigationDto,
	CreateToolExecutionDto,
	UpdateAgentExecutionDto,
} from "./dto/index.js";

export type { Investigation, AgentExecution, ToolExecution };

export type InvestigationWithRelations = Investigation & {
	incident: {
		id: string;
		number: number;
		title: string;
		severity: string;
		status: string;
	};
	agentExecutions: Array<
		AgentExecution & {
			toolExecutions: ToolExecution[];
		}
	>;
	recommendations: Recommendation[];
};

@Injectable()
export class InvestigationsService {
	private readonly logger = new Logger(InvestigationsService.name);

	constructor(
		private readonly prisma: PrismaService,
		@Inject(forwardRef(() => TimelineService))
		private readonly timelineService: TimelineService,
		private readonly overlayService: OverlayService,
	) {}

	/**
	 * Create a new investigation for an incident
	 */
	async create(dto: CreateInvestigationDto): Promise<Investigation> {
		const investigation = await this.prisma.investigation.create({
			data: {
				incidentId: dto.incidentId,
				status: "pending",
			},
		});

		this.logger.log(
			`Created investigation ${investigation.id} for incident ${dto.incidentId}`,
		);

		// Create timeline entry
		await this.timelineService.create({
			incidentId: dto.incidentId,
			type: TimelineEntryType.investigation_started,
			title: "Investigation started",
			description: "AI investigation has been queued",
			source: TimelineSource.system,
			metadata: { investigationId: investigation.id },
		});

		return investigation;
	}

	/**
	 * Find investigation by ID with all relations
	 */
	async findById(id: string): Promise<InvestigationWithRelations | null> {
		return this.prisma.investigation.findUnique({
			where: { id },
			include: {
				incident: {
					select: {
						id: true,
						number: true,
						title: true,
						severity: true,
						status: true,
					},
				},
				agentExecutions: {
					include: {
						toolExecutions: {
							orderBy: { executedAt: "asc" },
						},
					},
					orderBy: { createdAt: "asc" },
				},
				recommendations: {
					orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
				},
			},
		});
	}

	/**
	 * Find investigations by incident ID
	 */
	async findByIncidentId(incidentId: string): Promise<Investigation[]> {
		return this.prisma.investigation.findMany({
			where: { incidentId },
			orderBy: { createdAt: "desc" },
		});
	}

	/**
	 * Find all investigations
	 */
	async findAll(options?: {
		status?: string;
		limit?: number;
		offset?: number;
	}): Promise<InvestigationWithRelations[]> {
		return this.prisma.investigation.findMany({
			where: {
				...(options?.status && { status: options.status }),
			},
			include: {
				incident: {
					select: {
						id: true,
						number: true,
						title: true,
						severity: true,
						status: true,
					},
				},
				agentExecutions: {
					include: {
						toolExecutions: true,
					},
				},
				recommendations: true,
			},
			orderBy: { createdAt: "desc" },
			take: options?.limit,
			skip: options?.offset,
		});
	}

	/**
	 * Update investigation status
	 */
	async updateStatus(
		id: string,
		status: string,
	): Promise<Investigation | null> {
		try {
			const updateData: Record<string, unknown> = {
				status,
				updatedAt: new Date(),
			};

			if (status === "running") {
				updateData.startedAt = new Date();
			}

			if (status === "completed" || status === "failed") {
				updateData.completedAt = new Date();
			}

			return await this.prisma.investigation.update({
				where: { id },
				data: updateData,
			});
		} catch {
			return null;
		}
	}

	/**
	 * Update investigation status (internal API version with more control)
	 * Used by Python worker via internal API
	 */
	async updateStatusInternal(
		id: string,
		status: string,
		startedAt?: Date,
		error?: string,
		harnessThreadId?: string,
	): Promise<Investigation | null> {
		try {
			const updateData: Record<string, unknown> = {
				status,
				updatedAt: new Date(),
			};

			if (status === "running" && startedAt) {
				updateData.startedAt = startedAt;
			} else if (status === "running") {
				updateData.startedAt = new Date();
			}

			if (status === "completed" || status === "failed") {
				updateData.completedAt = new Date();
			}

			if (error) {
				updateData.error = error;
			}

			if (harnessThreadId) {
				updateData.harnessThreadId = harnessThreadId;
			}

			return await this.prisma.investigation.update({
				where: { id },
				data: updateData,
			});
		} catch {
			return null;
		}
	}

	/**
	 * Write full investigation result with all relations (atomic transaction)
	 * Used by Python worker via internal API
	 * Writes: investigation, agent_executions, tool_executions, recommendations, incident update, timeline
	 */
	async writeResultWithRelations(
		id: string,
		dto: InternalInvestigationResultDto,
	): Promise<InvestigationWithRelations | null> {
		try {
			const investigation = await this.prisma.investigation.findUnique({
				where: { id },
				select: { incidentId: true },
			});

			if (!investigation) return null;

			// Use transaction for atomic writes
			await this.prisma.$transaction(async (tx) => {
				// 1. Update investigation with results
				await tx.investigation.update({
					where: { id },
					data: {
						summary: dto.summary,
						rootCause: dto.rootCause,
						rootCauseCategory: dto.rootCauseCategory,
						report: dto.report ? JSON.stringify(dto.report) : null,
						error: dto.error,
						status: dto.status,
						completedAt: new Date(),
						updatedAt: new Date(),
					},
				});

				// 2. Create agent executions with nested tool executions
				if (dto.agentExecutions && dto.agentExecutions.length > 0) {
					for (const agent of dto.agentExecutions) {
						const agentExecution = await tx.agentExecution.create({
							data: {
								investigationId: id,
								agentName: agent.agentName,
								agentType: agent.agentType ?? "llm",
								status: agent.status ?? "completed",
								startedAt: agent.startedAt ? new Date(agent.startedAt) : null,
								completedAt: agent.completedAt
									? new Date(agent.completedAt)
									: null,
								executionTimeMs: agent.executionTimeMs,
								output: agent.output ? JSON.stringify(agent.output) : null,
								inputTokens: agent.inputTokens,
								outputTokens: agent.outputTokens,
								error: agent.error,
							},
						});

						// Create tool executions for this agent
						if (agent.toolExecutions && agent.toolExecutions.length > 0) {
							await tx.toolExecution.createMany({
								data: agent.toolExecutions.map((tool) => ({
									agentExecutionId: agentExecution.id,
									toolName: tool.toolName,
									toolCategory: tool.toolCategory,
									arguments: tool.arguments
										? JSON.stringify(tool.arguments)
										: null,
									result: tool.result ? JSON.stringify(tool.result) : null,
									status: tool.status ?? "success",
									executionTimeMs: tool.executionTimeMs,
									dataQuality: tool.dataQuality,
									error: tool.error,
								})),
							});
						}
					}
				}

				// 3. Create recommendations
				if (dto.recommendations && dto.recommendations.length > 0) {
					await tx.recommendation.createMany({
						data: dto.recommendations.map((rec) => ({
							investigationId: id,
							title: rec.title,
							description: rec.description,
							priority: rec.priority ?? "medium",
							category: rec.category,
							urgency: rec.urgency,
							actionable: rec.actionable ?? true,
							estimatedEffort: rec.estimatedEffort,
							status: "pending",
						})),
					});
				}

				// 4. Update incident status (only if not already resolved/closed)
				if (dto.status === "completed") {
					await tx.incident.updateMany({
						where: {
							id: dto.incidentId,
							status: { notIn: ["resolved", "closed"] },
						},
						data: {
							status: "identified",
							updatedAt: new Date(),
						},
					});
				}

				// 5. Create timeline entry for completion
				const timelineTitle =
					dto.status === "failed"
						? "Investigation failed"
						: "Investigation completed";
				const timelineDescription =
					dto.status === "failed"
						? `Investigation failed: ${dto.error ?? "Unknown error"}`
						: dto.rootCause
							? `Root cause identified: ${dto.rootCause}`
							: "Investigation completed";

				await tx.timelineEntry.create({
					data: {
						incidentId: dto.incidentId,
						type:
							dto.status === "failed"
								? "investigation_failed"
								: "investigation_completed",
						title: timelineTitle,
						description: timelineDescription,
						source: "ai_worker",
						metadata: JSON.stringify({
							investigationId: id,
							rootCause: dto.rootCause,
							rootCauseCategory: dto.rootCauseCategory,
							recommendationCount: dto.recommendations?.length ?? 0,
						}),
					},
				});
			});

			this.logger.log(
				`Wrote full result for investigation ${id} with ${dto.agentExecutions?.length ?? 0} agents and ${dto.recommendations?.length ?? 0} recommendations`,
			);

			// Reduce overlay (ADR-0016 §5c) — enrich the report app-side AFTER it
			// lands. Fire-and-forget: the canonical report is already persisted and
			// overlay failure must NEVER fail the investigation write.
			if (dto.status === "completed") {
				void this.overlayService.computeOverlay(id).catch((error) => {
					this.logger.error(
						`Overlay computation failed for investigation ${id}`,
						error,
					);
				});
			}

			return this.findById(id);
		} catch (error) {
			this.logger.error(
				`Failed to write result for investigation ${id}`,
				error,
			);
			return null;
		}
	}

	/**
	 * Create an agent execution record
	 */
	async createAgentExecution(
		dto: CreateAgentExecutionDto,
	): Promise<AgentExecution> {
		return this.prisma.agentExecution.create({
			data: {
				investigationId: dto.investigationId,
				agentName: dto.agentName,
				agentType: dto.agentType ?? "llm",
				status: "pending",
			},
		});
	}

	/**
	 * Update an agent execution
	 */
	async updateAgentExecution(
		id: string,
		dto: UpdateAgentExecutionDto,
	): Promise<AgentExecution | null> {
		try {
			const updateData: Record<string, unknown> = { ...dto };

			if (dto.output) {
				updateData.output =
					typeof dto.output === "string"
						? dto.output
						: JSON.stringify(dto.output);
			}

			return await this.prisma.agentExecution.update({
				where: { id },
				data: updateData,
			});
		} catch {
			return null;
		}
	}

	/**
	 * Create a tool execution record
	 */
	async createToolExecution(
		dto: CreateToolExecutionDto,
	): Promise<ToolExecution> {
		return this.prisma.toolExecution.create({
			data: {
				agentExecutionId: dto.agentExecutionId,
				toolName: dto.toolName,
				toolCategory: dto.toolCategory,
				arguments: dto.arguments ? JSON.stringify(dto.arguments) : null,
				result: dto.result ? JSON.stringify(dto.result) : null,
				status: dto.status ?? "pending",
				executionTimeMs: dto.executionTimeMs,
				error: dto.error,
			},
		});
	}

	/**
	 * Get agent executions for an investigation
	 */
	async getAgentExecutions(
		investigationId: string,
	): Promise<Array<AgentExecution & { toolExecutions: ToolExecution[] }>> {
		return this.prisma.agentExecution.findMany({
			where: { investigationId },
			include: {
				toolExecutions: {
					orderBy: { executedAt: "asc" },
				},
			},
			orderBy: { createdAt: "asc" },
		});
	}

	/**
	 * Get tool executions for an investigation (flat list)
	 */
	async getToolExecutions(investigationId: string): Promise<ToolExecution[]> {
		return this.prisma.toolExecution.findMany({
			where: {
				agentExecution: {
					investigationId,
				},
			},
			orderBy: { executedAt: "asc" },
		});
	}

	/**
	 * Count investigations
	 */
	async count(options?: { status?: string }): Promise<number> {
		return this.prisma.investigation.count({
			where: {
				...(options?.status && { status: options.status }),
			},
		});
	}

	/**
	 * Delete an investigation
	 */
	async delete(id: string): Promise<boolean> {
		try {
			await this.prisma.investigation.delete({
				where: { id },
			});
			return true;
		} catch {
			return false;
		}
	}
}
