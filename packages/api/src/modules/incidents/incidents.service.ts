// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import {
	ENDED_INCIDENT_STATUSES,
	type IncidentStats,
	incidentAttention,
	isIncidentEnded,
	isWorkflowLive,
	OPEN_INCIDENT_STATUSES,
} from "@prismalens/contracts";
import type { Alert, Incident, Service } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import { TimelineEntryType, TimelineSource } from "../../shared/enums/index.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import { TimelineService } from "../timeline/timeline.service.js";
import { CreateIncidentDto, UpdateIncidentDto } from "./dto/index.js";

export type { Incident };

/** Why a status changed, when the system changed it on its own (#605). */
export interface StatusNote {
	/** Appended to the timeline entry's description. */
	text: string;
	/** Machine-readable, stored as the entry's `metadata.reason`. */
	reason: string;
}

// Must mirror what the `findById`/`findByNumber`/`findAll` queries below
// actually return. `service` is joined with `service: true` (the whole row —
// the contract's `ServiceSchema` requires `type`, `tier`, `metadata`,
// `createdAt` and `updatedAt`, so a narrower type here misdescribes the
// payload), and every investigation `select` block lists `completedAt`
// alongside `createdAt`.
export type IncidentWithRelations = Incident & {
	alerts: Alert[];
	services?: Array<{ id: string; name: string; displayName: string | null }>;
	service?: Service | null;
	investigations?: Array<{
		id: string;
		status: string;
		summary: string | null;
		rootCause: string | null;
		rootCauseCategory: string | null;
		createdAt: Date;
		completedAt: Date | null;
		error?: string | null;
		harness?: string | null;
		model?: string | null;
		stopRequestedAt?: Date | null;
		lastEventAt?: Date | null;
		latestText?: string | null;
		evidenceCount?: number | null;
	}>;
	_count?: {
		alerts: number;
		investigations: number;
	};
};

@Injectable()
export class IncidentsService {
	private readonly logger = new Logger(IncidentsService.name);

	constructor(
		private readonly prisma: PrismaService,
		@Inject(forwardRef(() => TimelineService))
		private readonly timelineService: TimelineService,
		private readonly telemetry: TelemetryService,
	) {}

	/**
	 * Create a new incident
	 */
	async create(dto: CreateIncidentDto): Promise<Incident> {
		// Atomic incident number assignment with retry on unique constraint violation.
		// Uses transaction to minimize the race window between reading max number
		// and creating the incident. Retries handle concurrent webhook bursts.
		const MAX_RETRIES = 3;

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			try {
				const incident = await this.prisma.$transaction(async (tx) => {
					const lastIncident = await tx.incident.findFirst({
						orderBy: { number: "desc" },
						select: { number: true },
					});
					const nextNumber = (lastIncident?.number ?? 0) + 1;

					return tx.incident.create({
						data: {
							number: nextNumber,
							title: dto.title,
							description: dto.description,
							severity: dto.severity ?? "medium",
							status: "triggered",
							priority: dto.priority ?? "p3",
							serviceId: dto.serviceId,
							correlationReason: dto.correlationReason,
							tags: dto.tags ? JSON.stringify(dto.tags) : null,
							customerImpact: dto.customerImpact,
							alertCount: 0,
						},
					});
				});

				this.logger.log(
					`Created incident INC-${incident.number}: ${incident.title}`,
				);

				// Create timeline entry
				await this.timelineService.create({
					incidentId: incident.id,
					type: TimelineEntryType.incident_created,
					title: "Incident created",
					description: `Incident INC-${incident.number} was created`,
					source: TimelineSource.system,
				});

				return incident;
			} catch (error: unknown) {
				const isUniqueViolation =
					error instanceof Error && error.message.includes("Unique constraint");
				if (isUniqueViolation && attempt < MAX_RETRIES - 1) {
					this.logger.warn(
						`Incident number collision on attempt ${attempt + 1}, retrying`,
					);
					continue;
				}
				throw error;
			}
		}

		// Unreachable — loop always returns or throws
		throw new Error("Failed to create incident after retries");
	}

	/**
	 * Find incident by ID with full relations
	 */
	async findById(id: string): Promise<IncidentWithRelations | null> {
		return this.prisma.incident.findUnique({
			where: { id },
			include: {
				alerts: {
					// Deliberate current choice: order newest alert first as primary alert downstream
					orderBy: { triggeredAt: "desc" },
				},
				service: true,
				investigations: {
					select: {
						id: true,
						status: true,
						summary: true,
						rootCause: true,
						rootCauseCategory: true,
						createdAt: true,
						completedAt: true,
					},
					orderBy: { createdAt: "desc" },
				},
				_count: {
					select: { alerts: true, investigations: true },
				},
			},
		});
	}

	/**
	 * Find all incidents with filters
	 */
	async findAll(options?: {
		status?: string;
		open?: boolean;
		severity?: string;
		priority?: string;
		serviceId?: string;
		fromDate?: Date;
		toDate?: Date;
		limit?: number;
		offset?: number;
	}): Promise<{ data: IncidentWithRelations[]; total: number }> {
		const where = {
			...(options?.status
				? { status: options.status }
				: options?.open
					? { status: { in: [...OPEN_INCIDENT_STATUSES] } }
					: {}),
			...(options?.severity && { severity: options.severity }),
			...(options?.priority && { priority: options.priority }),
			...(options?.serviceId && {
				OR: [
					{ serviceId: options.serviceId },
					{ alerts: { some: { serviceId: options.serviceId } } },
				],
			}),
			...((options?.fromDate || options?.toDate) && {
				triggeredAt: {
					...(options?.fromDate && { gte: options.fromDate }),
					...(options?.toDate && { lte: options.toDate }),
				},
			}),
		};

		const [data, total] = await Promise.all([
			this.prisma.incident.findMany({
				where,
				include: {
					alerts: {
						take: 5, // Only include first 5 alerts for list view
						orderBy: { triggeredAt: "desc" },
					},
					service: true,
					investigations: {
						// No status filter: a `running` investigation must surface here too,
						// or the dashboard's progress bar (gated on status === "running")
						// can never render (#latestInvestigation bug).
						// Take multiple so an older completed investigation's rootCause
						// remains accessible when a newer investigation is running or failed.
						orderBy: { createdAt: "desc" },
						take: 5,
						select: {
							id: true,
							status: true,
							summary: true,
							rootCause: true,
							rootCauseCategory: true,
							error: true,
							harness: true,
							model: true,
							stopRequestedAt: true,
							createdAt: true,
							completedAt: true,
						},
					},
					_count: {
						select: { alerts: true, investigations: true },
					},
				},
				orderBy: [
					{ priority: "asc" },
					{ severity: "asc" },
					{ triggeredAt: "desc" },
				],
				take: options?.limit,
				skip: options?.offset,
			}),
			this.prisma.incident.count({ where }),
		]);

		return {
			data: await this.withLatestRun(await this.withServices(data)),
			total,
		};
	}

	/** Attach every service each incident touches: its own first, then its alerts'. */
	private async withServices(
		incidents: IncidentWithRelations[],
	): Promise<IncidentWithRelations[]> {
		if (incidents.length === 0) return incidents;
		const rows = await this.prisma.alert.findMany({
			where: {
				incidentId: { in: incidents.map((i) => i.id) },
				serviceId: { not: null },
			},
			distinct: ["incidentId", "serviceId"],
			select: {
				incidentId: true,
				service: { select: { id: true, name: true, displayName: true } },
			},
		});
		return incidents.map((incident) => {
			const services = new Map<
				string,
				{ id: string; name: string; displayName: string | null }
			>();
			if (incident.service) {
				services.set(incident.service.id, {
					id: incident.service.id,
					name: incident.service.name,
					displayName: incident.service.displayName ?? null,
				});
			}
			for (const row of rows) {
				if (row.incidentId === incident.id && row.service) {
					services.set(row.service.id, row.service);
				}
			}
			return { ...incident, services: [...services.values()] };
		});
	}

	/**
	 * What the list says about each incident's latest run (#743): when its last
	 * event landed and, while live, its latest agent sentence; once done, how
	 * much evidence backs its top hypothesis.
	 */
	private async withLatestRun(
		incidents: IncidentWithRelations[],
	): Promise<IncidentWithRelations[]> {
		const latest = incidents.flatMap(
			(i) => i.investigations?.slice(0, 1) ?? [],
		);
		if (latest.length === 0) return incidents;
		const live = latest
			.filter((r) => isWorkflowLive(r.status))
			.map((r) => r.id);
		const done = latest
			.filter((r) => r.status === "completed")
			.map((r) => r.id);
		const [lastEvents, steps, reports] = await Promise.all([
			this.prisma.investigationEvent.groupBy({
				by: ["investigationId"],
				where: { investigationId: { in: latest.map((r) => r.id) } },
				_max: { createdAt: true },
			}),
			Promise.all(
				live.map((id) =>
					this.prisma.investigationEvent.findFirst({
						where: {
							investigationId: id,
							event: { contains: '"kind":"agent_step"' },
						},
						orderBy: { seq: "desc" },
						select: { investigationId: true, event: true },
					}),
				),
			),
			done.length
				? this.prisma.investigation.findMany({
						where: { id: { in: done } },
						select: { id: true, report: true },
					})
				: [],
		]);
		const lastAt = new Map<string, Date | null>();
		for (const e of lastEvents) lastAt.set(e.investigationId, e._max.createdAt);
		const text = new Map<string, string | null>();
		for (const s of steps)
			if (s) text.set(s.investigationId, stepText(s.event));
		const evidence = new Map<string, number | null>();
		for (const r of reports) evidence.set(r.id, topEvidenceCount(r.report));
		return incidents.map((incident): IncidentWithRelations => {
			const [run, ...rest] = incident.investigations ?? [];
			if (!run) return incident;
			return {
				...incident,
				investigations: [
					{
						...run,
						lastEventAt: lastAt.get(run.id) ?? null,
						latestText: text.get(run.id) ?? null,
						evidenceCount: evidence.get(run.id) ?? null,
					},
					...rest,
				],
			};
		});
	}

	/**
	 * Update incident
	 */
	async update(
		id: string,
		dto: UpdateIncidentDto,
		statusNote?: StatusNote,
	): Promise<Incident | null> {
		try {
			const existing = await this.prisma.incident.findUnique({ where: { id } });
			if (!existing) return null;

			const updateData: Record<string, unknown> = {
				...dto,
				updatedAt: new Date(),
			};

			if (dto.tags) {
				updateData.tags = JSON.stringify(dto.tags);
			}

			// Track status changes
			if (dto.status && dto.status !== existing.status) {
				if (dto.status === "investigating" && !existing.acknowledgedAt) {
					updateData.acknowledgedAt = new Date();
					updateData.timeToAcknowledge = Math.floor(
						(Date.now() - existing.triggeredAt.getTime()) / 1000,
					);
				}
				if (isIncidentEnded(dto.status) && !existing.resolvedAt) {
					updateData.resolvedAt = new Date();
					updateData.timeToResolve = Math.floor(
						(Date.now() - existing.triggeredAt.getTime()) / 1000,
					);
				}
			}

			const incident = await this.prisma.incident.update({
				where: { id },
				data: updateData,
			});

			// Create timeline entry for status change
			if (dto.status && dto.status !== existing.status) {
				await this.timelineService.create({
					incidentId: id,
					type: TimelineEntryType.status_changed,
					title: "Status changed",
					description: `Status changed from ${existing.status} to ${dto.status}${statusNote ? `: ${statusNote.text}` : ""}`,
					source: TimelineSource.system,
					metadata: {
						previousStatus: existing.status,
						newStatus: dto.status,
						...(statusNote && { reason: statusNote.reason }),
					},
				});
			}

			this.logger.log(`Updated incident ${id}`);
			return incident;
		} catch {
			return null;
		}
	}

	/**
	 * Add an alert to an incident (correlation)
	 */
	async addAlert(incidentId: string, alertId: string): Promise<boolean> {
		try {
			const outcome = await this.prisma.$transaction(
				async (tx): Promise<"missing" | "already-linked" | "linked"> => {
					const existingAlert = await tx.alert.findUnique({
						where: { id: alertId },
						select: { title: true, incidentId: true },
					});

					if (!existingAlert) {
						return "missing";
					}

					// Atomically claim the alert. The WHERE clause is the idempotency
					// guard: it matches only while the alert is not already linked to
					// this incident, so concurrent correlation calls cannot both pass a
					// read-then-write check and double-increment `alertCount`. The guard
					// is keyed on incidentId (never on status) per the #244 suppress
					// spec. The OR spells out the NULL case explicitly rather than
					// relying on how `not` treats NULL on a nullable column.
					const claim = await tx.alert.updateMany({
						where: {
							id: alertId,
							OR: [{ incidentId: null }, { incidentId: { not: incidentId } }],
						},
						data: {
							incidentId,
							status: "correlated",
						},
					});

					if (claim.count === 0) {
						return "already-linked";
					}

					// The claim above can also move an alert off a DIFFERENT incident
					// (the OR clause matches incidentId !== target too), so that
					// incident's alertCount must be decremented in the same
					// transaction — otherwise it keeps counting an alert it no
					// longer owns.
					const previousIncidentId = existingAlert.incidentId;
					if (previousIncidentId && previousIncidentId !== incidentId) {
						await tx.incident.update({
							where: { id: previousIncidentId },
							data: {
								alertCount: { decrement: 1 },
							},
						});
					}

					await tx.incident.update({
						where: { id: incidentId },
						data: {
							alertCount: { increment: 1 },
						},
					});

					// The timeline entry is the audit record for the increment above, so
					// it is written inside the same transaction — otherwise a failure
					// between the two leaves a counted alert with no timeline evidence.
					await tx.timelineEntry.create({
						data: {
							incidentId,
							type: TimelineEntryType.alert_added,
							title: "Alert added",
							description: `Alert "${existingAlert.title}" was correlated to this incident`,
							source: TimelineSource.system,
							metadata: JSON.stringify({ alertId }),
							occurredAt: new Date(),
						},
					});

					return "linked";
				},
			);

			if (outcome === "missing") {
				return false;
			}

			if (outcome === "linked") {
				this.logger.log(`Added alert ${alertId} to incident ${incidentId}`);
			}

			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Remove an alert from an incident
	 */
	async removeAlert(incidentId: string, alertId: string): Promise<boolean> {
		try {
			await this.prisma.$transaction([
				this.prisma.alert.update({
					where: { id: alertId },
					data: {
						incidentId: null,
						status: "triggered",
					},
				}),
				this.prisma.incident.update({
					where: { id: incidentId },
					data: {
						alertCount: { decrement: 1 },
					},
				}),
			]);

			await this.timelineService.create({
				incidentId,
				type: TimelineEntryType.alert_removed,
				title: "Alert removed",
				description: `Alert was removed from this incident`,
				source: TimelineSource.system,
				metadata: { alertId },
			});

			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Resolve an incident
	 */
	async resolve(id: string, note?: StatusNote): Promise<Incident | null> {
		return this.update(id, { status: "resolved" }, note);
	}

	/**
	 * Close an incident (after postmortem)
	 */
	async close(
		id: string,
		cause: { actualCause?: string; actualCauseCategory?: string } = {},
	): Promise<Incident | null> {
		// One update, not two (#667 review). Closing and recording the cause used
		// to be separate writes, so a failure between them left the incident
		// closed with the cause silently dropped while the API reported failure —
		// the one outcome the operator cannot tell from the UI. `update` writes
		// the status, the resolve timestamps and these fields in a single row
		// write, so either all of it lands or none of it does.
		const actualCause = cause.actualCause?.trim() || undefined;
		const incident = await this.update(id, {
			status: "closed",
			...(actualCause ? { actualCause } : {}),
			...(cause.actualCauseCategory
				? { actualCauseCategory: cause.actualCauseCategory }
				: {}),
		});
		// The fact that one was closed, with no identifier and no content (#602).
		if (incident) await this.telemetry.capture("incident_closed", {});
		return incident;
	}

	/**
	 * Counts over a window, never over a page: the queue's stats and the
	 * "needs you" numbers come from here so they agree with the rows, which
	 * read the same `incidentAttention` predicate from the contracts.
	 */
	async getStats(options?: {
		serviceId?: string;
		fromDate?: Date;
		toDate?: Date;
	}): Promise<IncidentStats> {
		const where = {
			...(options?.serviceId && {
				OR: [
					{ serviceId: options.serviceId },
					{ alerts: { some: { serviceId: options.serviceId } } },
				],
			}),
			...((options?.fromDate || options?.toDate) && {
				triggeredAt: {
					...(options?.fromDate && { gte: options.fromDate }),
					...(options?.toDate && { lte: options.toDate }),
				},
			}),
		};
		const [byStatus, bySeverity, ended, candidates] = await Promise.all([
			this.prisma.incident.groupBy({ by: ["status"], where, _count: true }),
			this.prisma.incident.groupBy({ by: ["severity"], where, _count: true }),
			this.prisma.incident.aggregate({
				where: {
					...where,
					status: { in: [...ENDED_INCIDENT_STATUSES] },
					timeToResolve: { not: null },
				},
				_avg: { timeToResolve: true },
			}),
			// Everything that could want a human: open, plus resolved-not-closed.
			this.prisma.incident.findMany({
				where: {
					...where,
					status: { in: [...OPEN_INCIDENT_STATUSES, "resolved"] },
				},
				select: {
					status: true,
					investigations: {
						orderBy: { createdAt: "desc" },
						take: 1,
						select: { status: true },
					},
				},
			}),
		]);

		const statusCounts = Object.fromEntries(
			byStatus.map((row) => [row.status, row._count]),
		);
		const attention = { failed_run: 0, unacknowledged: 0, awaiting_close: 0 };
		for (const row of candidates) {
			const why = incidentAttention(row.status, row.investigations[0]?.status);
			if (why) attention[why] += 1;
		}

		return {
			total: byStatus.reduce((acc, row) => acc + row._count, 0),
			open: OPEN_INCIDENT_STATUSES.reduce(
				(acc, s) => acc + (statusCounts[s] ?? 0),
				0,
			),
			byStatus: statusCounts,
			bySeverity: Object.fromEntries(
				bySeverity.map((row) => [row.severity, row._count]),
			),
			attention,
			avgTimeToResolve: ended._avg.timeToResolve ?? null,
		};
	}

	/**
	 * Count incidents
	 */
	async count(options?: {
		status?: string;
		severity?: string;
		priority?: string;
	}): Promise<number> {
		return this.prisma.incident.count({
			where: {
				...(options?.status && { status: options.status }),
				...(options?.severity && { severity: options.severity }),
				...(options?.priority && { priority: options.priority }),
			},
		});
	}
}

function stepText(raw: string): string | null {
	const parsed = safeParseJsonObject(raw) as { text?: unknown } | null;
	const text = typeof parsed?.text === "string" ? parsed.text.trim() : "";
	return text ? text.slice(0, 280) : null;
}

function topEvidenceCount(raw: string | null): number | null {
	const report = safeParseJsonObject(raw) as {
		hypotheses?: Array<{ evidence?: unknown[] }>;
	} | null;
	const top = report?.hypotheses?.[0];
	return Array.isArray(top?.evidence) ? top.evidence.length : null;
}
