import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import type { CanonicalEvent } from "@prismalens/contracts";
import {
	CanonicalEventSchema,
	INVESTIGATION_REPORT_BRANCH,
} from "@prismalens/contracts";
import {
	type AgentExecution,
	type Investigation,
	Prisma,
	type Recommendation,
	type ToolExecution,
} from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import type { InternalInvestigationResultDto } from "../../infrastructure/internal/dto/investigation-result.dto.js";
import { TimelineEntryType, TimelineSource } from "../../shared/enums/index.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
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
	 * Cancel a still-PENDING investigation (CANCEL slice, ADR-0018). When a run is
	 * cancelled before any worker picks it up, the queued job is removed directly (no
	 * worker is subscribed to its cancel channel) and the API owns the terminal write —
	 * there is no worker to persist "cancelled". Flips the status and records a timeline
	 * entry, mirroring the worker's cancelled record for a running run.
	 */
	async cancelPending(
		id: string,
		incidentId: string,
	): Promise<Investigation | null> {
		const updated = await this.updateStatus(id, "cancelled");
		await this.timelineService.create({
			incidentId,
			type: TimelineEntryType.investigation_completed,
			title: "Investigation cancelled",
			description: "The investigation was cancelled before it started.",
			source: TimelineSource.system,
			metadata: { investigationId: id },
		});
		return updated;
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
	 * Append a batch of canonical events to the durable record (ADR-0018
	 * `store.append`). Idempotent: each row is keyed on
	 * `(investigationId, branchId, seq)`, so a duplicate from a batch retry is a
	 * no-op (P2002 swallowed), not an error. The terminal `report` event carries no
	 * `branchId`, so it lands under the {@link INVESTIGATION_REPORT_BRANCH} sentinel.
	 *
	 * Insert strategy — SQLite's `createMany` has no `skipDuplicates` (the generated
	 * client omits it), so a per-row insert that swallows the unique violation is the
	 * dialect-agnostic idempotency path. PostgreSQL could use
	 * `createMany({ skipDuplicates: true })`, but keeping ONE path avoids a
	 * dialect branch and behaves identically on retry. Batches are small (≤25).
	 *
	 * @returns how many rows were newly inserted vs skipped as duplicates.
	 */
	async appendEvents(
		investigationId: string,
		events: CanonicalEvent[],
	): Promise<{ inserted: number; duplicates: number }> {
		let inserted = 0;
		let duplicates = 0;
		for (const event of events) {
			const branchId =
				"branchId" in event ? event.branchId : INVESTIGATION_REPORT_BRANCH;
			try {
				await this.prisma.investigationEvent.create({
					data: {
						investigationId,
						seq: event.seq,
						branchId,
						// Stored as JSON text (sqlite String / pg JSONB) and re-parsed on
						// read — mirrors the report/overlay dialect split.
						event: JSON.stringify(event),
					},
				});
				inserted++;
			} catch (error) {
				if (
					error instanceof Prisma.PrismaClientKnownRequestError &&
					error.code === "P2002"
				) {
					duplicates++;
					continue;
				}
				throw error;
			}
		}
		return { inserted, duplicates };
	}

	/**
	 * Delete the durable canonical event record for an investigation (ADR-0018 B.4).
	 *
	 * Called by the worker at the START of a BullMQ RETRY (attempt 2+): each attempt's
	 * events are keyed on `(investigationId, branchId, seq)`, so a retry's rows collide
	 * with the failed attempt's and get swallowed as duplicates (P2002) — leaving the
	 * durable record showing the FAILED attempt's events for a run that later completed.
	 * Clearing first gives each attempt a fresh record. Idempotent (deleteMany of zero
	 * rows is a no-op).
	 *
	 * @returns how many rows were deleted.
	 */
	async clearEvents(investigationId: string): Promise<number> {
		const { count } = await this.prisma.investigationEvent.deleteMany({
			where: { investigationId },
		});
		if (count > 0) {
			this.logger.log(
				`Cleared ${count} durable event(s) for investigation ${investigationId} (retry)`,
			);
		}
		return count;
	}

	/**
	 * Read a page of the durable canonical event record for replay/history
	 * (ADR-0018). Paginated by an exclusive `seq` cursor; each stored blob is parsed
	 * back through {@link CanonicalEventSchema} on the way out (a corrupt row is
	 * dropped + logged, never surfaced). Ordered by `(seq, branchId)`.
	 *
	 * NOTE: `seq` is per-branch monotonic (fan-out, B.2), so across N branches the
	 * same `seq` recurs; the cursor is best-effort history ordering, not a globally
	 * unique key. The single-branch case (today) has a globally monotonic `seq`.
	 *
	 * @returns the parsed events plus the `nextCursor` (`seq` to resume from, or null).
	 */
	async getEvents(
		investigationId: string,
		cursor: number | undefined,
		limit: number,
	): Promise<{ events: CanonicalEvent[]; nextCursor: number | null }> {
		const rows = await this.prisma.investigationEvent.findMany({
			where: {
				investigationId,
				...(cursor !== undefined ? { seq: { gt: cursor } } : {}),
			},
			orderBy: [{ seq: "asc" }, { branchId: "asc" }],
			take: limit,
		});

		const events: CanonicalEvent[] = [];
		for (const row of rows) {
			const obj = safeParseJsonObject(row.event);
			const parsed = obj ? CanonicalEventSchema.safeParse(obj) : null;
			if (parsed?.success) {
				events.push(parsed.data);
			} else {
				this.logger.warn(
					`Dropped corrupt durable event row ${row.id} for investigation ${investigationId}`,
				);
			}
		}

		const nextCursor =
			rows.length === limit ? (rows[rows.length - 1]?.seq ?? null) : null;
		return { events, nextCursor };
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
