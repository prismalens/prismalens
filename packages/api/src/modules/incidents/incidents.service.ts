// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import {
	ENDED_INCIDENT_STATUSES,
	type IncidentStats,
	incidentAttention,
	isIncidentEnded,
	isIncidentOpen,
	isWorkflowLive,
	LIVE_WORKFLOW_STATUSES,
	latestRun,
	OPEN_ALERT_STATUSES,
	OPEN_INCIDENT_STATUSES,
} from "@prismalens/contracts";
import type { Alert, Incident, Prisma, Service } from "@prismalens/database";
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
		kind?: string;
		agentMode?: string | null;
		title?: string | null;
		startedAt?: Date | null;
		/** A completed investigation wrote its summary from its report; a chat has none (#673). */
		hasReport?: boolean;
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
	priorIncident?: {
		number: number;
		status: string;
		actualCause: string | null;
	} | null;
	refiredAs?: { id: string; number: number; createdAt: Date } | null;
	mergedInto?: { id: string; number: number } | null;
};

/** Why a merge was refused; the controller maps each to its HTTP error. */
export type MergeRefusal =
	| "same-incident"
	| "source-missing"
	| "target-missing"
	| "source-merged"
	| "source-ended"
	| "source-run-live"
	| "target-not-open";

export type MergeOutcome =
	| { ok: true; target: Incident; moved: number }
	| { ok: false; reason: MergeRefusal; message: string };

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
							priorIncidentId: dto.priorIncident?.id ?? null,
							alertCount: 0,
						},
					});
				});

				this.logger.log(
					`Created incident INC-${incident.number}: ${incident.title}`,
				);

				const prior = dto.priorIncident;
				await this.timelineService.create({
					incidentId: incident.id,
					type: TimelineEntryType.incident_created,
					title: "Incident created",
					description: prior
						? `New incident: ${prior.alertName} fired again after INC-${prior.number} ${prior.status === "closed" ? "was resolved" : "had its alerts cleared"} ${(prior.endedAt ?? new Date()).toISOString()}`
						: `Incident INC-${incident.number} was created`,
					source: TimelineSource.system,
					...(prior ? { metadata: { priorIncidentId: prior.id } } : {}),
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
						error: true,
						harness: true,
						model: true,
						stopRequestedAt: true,
						kind: true,
						agentMode: true,
						title: true,
						startedAt: true,
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

	/** `findById` plus what the list says about the latest run, so detail and list agree (#743). */
	async findDetail(id: string): Promise<IncidentWithRelations | null> {
		const incident = await this.findById(id);
		if (!incident) return null;
		const [withRun] = await this.withLatestRun([incident]);
		return (await this.withLineage([withRun]))[0];
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
							kind: true,
							agentMode: true,
							title: true,
							startedAt: true,
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
			data: await this.withLineage(
				await this.withLatestRun(await this.withServices(data)),
			),
			total,
		};
	}

	/**
	 * The incident this one fired again after, and the newest one that fired
	 * again after this one (R1a d5), so a card can say both without a request.
	 */
	private async withLineage(
		incidents: IncidentWithRelations[],
	): Promise<IncidentWithRelations[]> {
		if (incidents.length === 0) return incidents;
		const priorIds = [
			...new Set(
				incidents.flatMap((i) =>
					i.priorIncidentId ? [i.priorIncidentId] : [],
				),
			),
		];
		const mergedIds = [
			...new Set(
				incidents.flatMap((i) => (i.mergedIntoId ? [i.mergedIntoId] : [])),
			),
		];
		const [priors, refires, targets] = await Promise.all([
			this.prisma.incident.findMany({
				where: { id: { in: priorIds } },
				select: { id: true, number: true, status: true, actualCause: true },
			}),
			this.prisma.incident.findMany({
				where: { priorIncidentId: { in: incidents.map((i) => i.id) } },
				select: {
					id: true,
					priorIncidentId: true,
					number: true,
					createdAt: true,
				},
				orderBy: { createdAt: "desc" },
			}),
			mergedIds.length
				? this.prisma.incident.findMany({
						where: { id: { in: mergedIds } },
						select: { id: true, number: true },
					})
				: Promise.resolve<Array<{ id: string; number: number }>>([]),
		]);
		const prior = new Map(priors.map((p) => [p.id, p]));
		const target = new Map(targets.map((t) => [t.id, t]));
		const refired = new Map<
			string,
			{ id: string; number: number; createdAt: Date }
		>();
		for (const r of refires) {
			if (r.priorIncidentId && !refired.has(r.priorIncidentId))
				refired.set(r.priorIncidentId, {
					id: r.id,
					number: r.number,
					createdAt: r.createdAt,
				});
		}
		return incidents.map((incident) => {
			const p = incident.priorIncidentId
				? prior.get(incident.priorIncidentId)
				: undefined;
			return {
				...incident,
				priorIncident: p
					? { number: p.number, status: p.status, actualCause: p.actualCause }
					: null,
				refiredAs: refired.get(incident.id) ?? null,
				mergedInto: incident.mergedIntoId
					? (target.get(incident.mergedIntoId) ?? null)
					: null,
			};
		});
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
				].map((r) => ({
					...r,
					hasReport:
						r.kind !== "chat" &&
						r.status === "completed" &&
						typeof r.summary === "string",
				})),
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
		/** The timeline entry's title for a status change, when the caller names it. */
		entryTitle?: string,
	): Promise<Incident | null> {
		try {
			const existing = await this.prisma.incident.findUnique({ where: { id } });
			if (!existing) return null;

			const updateData: Record<string, unknown> = {
				...dto,
				updatedAt: new Date(),
			};
			// Clearing the recorded cause after Resolve (R1a d3).
			if (dto.actualCause === "") updateData.actualCause = null;

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
				// Only the source's ending is "alerts cleared"; Resolve stamps closedAt.
				if (dto.status === "resolved" && !existing.resolvedAt) {
					updateData.resolvedAt = new Date();
					updateData.timeToResolve = Math.floor(
						(Date.now() - existing.triggeredAt.getTime()) / 1000,
					);
				}
				// Reopened: the next resolve stamps a fresh resolve time (#743).
				if (isIncidentEnded(existing.status) && !isIncidentEnded(dto.status)) {
					updateData.resolvedAt = null;
					updateData.timeToResolve = null;
				}
				// Only the operator's Resolve is reopened by hand (R1a d4); the
				// recorded cause stays as Previous cause until the next Resolve.
				if (existing.status === "closed" && !isIncidentEnded(dto.status)) {
					updateData.closedAt = null;
					updateData.timeToClose = null;
					updateData.reopenedAt = new Date();
					updateData.reopenReason = "operator";
				}
				// Every path to `closed` records the operator's Resolve (R1a d3).
				if (dto.status === "closed" && dto.closedAt === undefined) {
					const now = new Date();
					updateData.closedAt = now;
					updateData.timeToClose = Math.max(
						0,
						Math.floor((now.getTime() - existing.triggeredAt.getTime()) / 1000),
					);
					updateData.reopenedAt = null;
					updateData.reopenReason = null;
				}
			}
			const reopened =
				!!dto.status &&
				isIncidentEnded(existing.status) &&
				!isIncidentEnded(dto.status);
			const ending: "incident-resolved" | "incident-closed" | null =
				dto.status === existing.status
					? null
					: dto.status === "resolved"
						? "incident-resolved"
						: dto.status === "closed"
							? "incident-closed"
							: null;

			// One transaction: the row, its status entry and the alerts it ends
			// commit together, so a failed entry never reports a landed close as
			// failed (#776 review).
			const incident = await this.prisma.$transaction(async (tx) => {
				const row = await tx.incident.update({
					where: { id },
					data: updateData,
				});
				if (dto.status && dto.status !== existing.status) {
					await tx.timelineEntry.create({
						data: {
							incidentId: id,
							type: TimelineEntryType.status_changed,
							title:
								entryTitle ??
								(statusNote?.reason === "alertmanager-absence"
									? "Alerts cleared: no Alertmanager still lists it"
									: undefined) ??
								(ending === "incident-closed"
									? "Resolved"
									: reopened
										? "Incident reopened"
										: "Status changed"),
							description: `Status changed from ${existing.status} to ${dto.status}${statusNote ? `: ${statusNote.text}` : ""}`,
							source: TimelineSource.system,
							metadata: JSON.stringify({
								previousStatus: existing.status,
								newStatus: dto.status,
								...(statusNote && { reason: statusNote.reason }),
							}),
						},
					});
				}
				if (ending) await this.resolveFiringAlerts(tx, id, ending);
				return row;
			});

			this.logger.log(`Updated incident ${id}`);
			// The fact that one was closed, with no identifier and no content (#602).
			if (ending === "incident-closed")
				await this.telemetry.capture("incident_closed", {});
			return incident;
		} catch {
			return null;
		}
	}

	/**
	 * Resolve and Close end the incident's still-firing alerts with it (walk
	 * f32); a later refire is a new episode and a new incident, never a count
	 * on this one. Written in the status write's transaction.
	 */
	private async resolveFiringAlerts(
		tx: Prisma.TransactionClient,
		incidentId: string,
		reason: "incident-resolved" | "incident-closed",
	): Promise<void> {
		const now = new Date();
		const firing = await tx.alert.findMany({
			where: { incidentId, status: { in: [...OPEN_ALERT_STATUSES] } },
			select: { id: true },
		});
		if (firing.length === 0) return;
		const alertIds = firing.map((a) => a.id);
		await tx.alert.updateMany({
			where: { id: { in: alertIds } },
			data: { status: "resolved", resolvedAt: now, updatedAt: now },
		});
		await tx.alertSourceAlert.updateMany({
			where: { alertId: { in: alertIds }, resolvedAt: null },
			data: { resolvedAt: now },
		});
		await tx.timelineEntry.create({
			data: {
				incidentId,
				type: TimelineEntryType.status_changed,
				title: `Resolved ${alertIds.length} firing alert${alertIds.length === 1 ? "" : "s"} with the incident`,
				description: `${reason === "incident-closed" ? "The incident was resolved" : "The incident's alerts cleared"}, so its alerts no longer fire here; a refire opens a new episode`,
				source: TimelineSource.system,
				metadata: JSON.stringify({ reason, alertIds }),
				occurredAt: now,
			},
		});
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
	 * Merge `sourceId` into `targetId` (#673 w37): every alert on the source
	 * moves, the source ends as Resolved with `mergedIntoId`, and both Timelines
	 * say so. The source's runs stay on the source. One transaction.
	 */
	async merge(sourceId: string, targetId: string): Promise<MergeOutcome> {
		const refuse = (reason: MergeRefusal, message: string): MergeOutcome => ({
			ok: false,
			reason,
			message,
		});
		if (sourceId === targetId)
			return refuse("same-incident", "An incident cannot merge into itself");
		const live = { status: { in: [...LIVE_WORKFLOW_STATUSES] } };
		const outcome = await this.prisma.$transaction(
			async (tx): Promise<MergeOutcome> => {
				const [source, target] = await Promise.all([
					tx.incident.findUnique({
						where: { id: sourceId },
						include: {
							service: { select: { name: true, displayName: true } },
							investigations: { where: live, select: { id: true } },
						},
					}),
					tx.incident.findUnique({
						where: { id: targetId },
						include: {
							investigations: { where: live, select: { id: true } },
						},
					}),
				]);
				if (!source)
					return refuse("source-missing", `Incident ${sourceId} not found`);
				if (!target)
					return refuse("target-missing", `Incident ${targetId} not found`);
				if (source.mergedIntoId)
					return refuse(
						"source-merged",
						`INC-${source.number} was already merged`,
					);
				if (isIncidentEnded(source.status))
					return refuse(
						"source-ended",
						`INC-${source.number} has ended; reopen it to merge it`,
					);
				if (source.investigations.length > 0)
					return refuse(
						"source-run-live",
						`INC-${source.number} has a run working; stop it before merging`,
					);
				if (!isIncidentOpen(target.status))
					return refuse(
						"target-not-open",
						`INC-${target.number} has ended; merge into an open incident`,
					);

				const alerts = await tx.alert.findMany({
					where: { incidentId: sourceId },
					select: {
						id: true,
						service: {
							select: {
								name: true,
								displayName: true,
								repositories: {
									select: { repository: { select: { url: true } } },
								},
							},
						},
					},
				});
				const alertIds = alerts.map((a) => a.id);
				const now = new Date();
				await tx.alert.updateMany({
					where: { id: { in: alertIds } },
					data: { incidentId: targetId, updatedAt: now },
				});
				await tx.incident.update({
					where: { id: sourceId },
					data: {
						status: "closed",
						closedAt: now,
						reopenedAt: null,
						reopenReason: null,
						mergedIntoId: targetId,
						alertCount: 0,
						updatedAt: now,
					},
				});
				const updated = await tx.incident.update({
					where: { id: targetId },
					data: { alertCount: { increment: alertIds.length }, updatedAt: now },
				});

				const services = [
					...new Set(
						alerts.flatMap((a) =>
							a.service ? [a.service.displayName || a.service.name] : [],
						),
					),
				];
				if (services.length === 0 && source.service)
					services.push(source.service.displayName || source.service.name);
				const repos = [
					...new Set(
						alerts.flatMap(
							(a) =>
								a.service?.repositories.map((r) =>
									repoName(r.repository.url),
								) ?? [],
						),
					),
				];
				const count = `${alertIds.length} alert${alertIds.length === 1 ? "" : "s"}`;
				// A live run keeps the workspace it cloned; only the next one sees the moved repos.
				const liveNote =
					target.investigations.length > 0 && repos.length > 0
						? ` The working run keeps its workspace; the next run also clones ${repos.join(", ")}.`
						: "";
				await tx.timelineEntry.create({
					data: {
						incidentId: sourceId,
						type: TimelineEntryType.status_changed,
						title: `Merged into INC-${target.number}`,
						description: `Its ${count} moved to INC-${target.number}`,
						source: TimelineSource.user,
						metadata: JSON.stringify({
							previousStatus: source.status,
							newStatus: "closed",
							reason: "merged",
							mergedIntoId: targetId,
						}),
						occurredAt: now,
					},
				});
				await tx.timelineEntry.create({
					data: {
						incidentId: targetId,
						type: TimelineEntryType.alert_added,
						title: `Merged INC-${source.number}: ${count}${services.length ? ` from ${services.join(", ")}` : ""}`,
						description: `INC-${source.number} ended; its alerts fire here now.${liveNote}`,
						source: TimelineSource.user,
						metadata: JSON.stringify({
							reason: "merged",
							mergedFromId: sourceId,
							alertIds,
						}),
						occurredAt: now,
					},
				});
				return { ok: true, target: updated, moved: alertIds.length };
			},
		);
		if (outcome.ok)
			this.logger.log(
				`Merged incident ${sourceId} into ${targetId} (${outcome.moved} alerts)`,
			);
		return outcome;
	}

	/**
	 * Resolve an incident
	 */
	async resolve(id: string, note?: StatusNote): Promise<Incident | null> {
		return this.update(id, { status: "resolved" }, note);
	}

	/**
	 * The operator's Resolve (R1a d3), stored as `closed`: from any open status
	 * or from Alerts cleared, the cause optional. It stamps `closedAt` and
	 * `timeToClose` and clears the reopen marker; `resolvedAt` keeps meaning
	 * the alerts cleared.
	 */
	async close(
		id: string,
		cause: { actualCause?: string; actualCauseCategory?: string } = {},
	): Promise<Incident | null> {
		// One update, not two (#667 review): the status, the stamps and the cause
		// land in a single row write, or none of it does.
		const existing = await this.prisma.incident.findUnique({
			where: { id },
			select: { triggeredAt: true },
		});
		if (!existing) return null;
		const actualCause = cause.actualCause?.trim() || undefined;
		const now = new Date();
		const incident = await this.update(
			id,
			{
				status: "closed",
				...(actualCause ? { actualCause } : {}),
				...(cause.actualCauseCategory
					? { actualCauseCategory: cause.actualCauseCategory }
					: {}),
				closedAt: now,
				timeToClose: Math.max(
					0,
					Math.floor((now.getTime() - existing.triggeredAt.getTime()) / 1000),
				),
				reopenedAt: null,
				reopenReason: null,
			},
			undefined,
			actualCause ? "Resolved, cause recorded" : "Resolved",
		);
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
			// A merged incident is counted on its target (#673 w37).
			mergedIntoId: null,
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
					reopenReason: true,
					reopenedAt: true,
					// Every kind: a failed run counts only if it is an investigation, a reopen clears on any run (#673).
					investigations: {
						orderBy: { createdAt: "desc" },
						select: { status: true, createdAt: true, kind: true },
					},
				},
			}),
		]);

		const statusCounts = Object.fromEntries(
			byStatus.map((row) => [row.status, row._count]),
		);
		const attention = {
			failed_run: 0,
			unacknowledged: 0,
			reopened: 0,
			awaiting_close: 0,
		};
		for (const row of candidates) {
			const why = incidentAttention(
				row.status,
				latestRun(row, { kind: "investigation" })?.status,
				{
					reason: row.reopenReason,
					at: row.reopenedAt,
					latestRunAt: latestRun(row)?.createdAt,
				},
			);
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

/** The folder a repo URL or path clones to: its last segment, without `.git`. */
function repoName(url: string): string {
	const last =
		url
			.replace(/[/\\]+$/, "")
			.split(/[/\\:]/)
			.pop() ?? url;
	return last.replace(/\.git$/, "") || url;
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
