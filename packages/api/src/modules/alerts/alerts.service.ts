// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as crypto from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "@prismalens/config";
import { UNASSIGNED_ALERT_STATUSES } from "@prismalens/contracts/schemas";
import type { Alert } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	AlertStatus,
	TimelineEntryType,
	TimelineSource,
} from "../../shared/enums/index.js";
import { CreateAlertDto, UpdateAlertDto } from "./dto/index.js";

export type { Alert };

/**
 * What a refire of an existing `dedupKey` did, per the #231 rulings. Returned
 * alongside the alert so callers (and tests) can see the branch that ran.
 */
export type DedupOutcome =
	/** R2a — open alert (not resolved/suppressed): counter bump only. */
	| "counted"
	/** R1 — resolved inside the flap window: reopened to `triggered`. */
	| "reopened"
	/** R2c — suppressed: counter bump, suppression is forward-only. */
	| "counted-suppressed"
	/** R2b — resolved outside the flap window: a new episode row. */
	| "new-episode";

export type AlertWithRelations = Alert & {
	incident?: {
		id: string;
		number: number;
		title: string;
		status: string;
	} | null;
	service?: {
		id: string;
		name: string;
		displayName: string | null;
	} | null;
	events?: Array<{
		id: string;
		source: string;
		eventType: string;
		receivedAt: Date;
	}>;
};

@Injectable()
export class AlertsService {
	private readonly logger = new Logger(AlertsService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService<EnvironmentVariables, true>,
	) {}

	/**
	 * The #231 flap window in ms. No `.get(key, fallback)` fallback: the zod
	 * schema default (15 min) is authoritative and would silently win anyway.
	 */
	private flapWindowMs(): number {
		return (
			this.configService.get("PRISMALENS_ALERT_FLAP_WINDOW_MINUTES", {
				infer: true,
			}) *
			60 *
			1000
		);
	}

	/**
	 * Generate dedup key for alert deduplication
	 */
	generateDedupKey(dto: CreateAlertDto): string {
		const input = `${dto.source ?? "unknown"}:${dto.title}:${dto.severity ?? "medium"}:${dto.serviceId ?? ""}`;
		return crypto
			.createHash("sha256")
			.update(input)
			.digest("hex")
			.substring(0, 32);
	}

	/**
	 * Generate fingerprint for similarity matching
	 */
	generateFingerprint(dto: CreateAlertDto): string {
		const normalized = [
			dto.title.toLowerCase().replace(/[^a-z0-9]/g, ""),
			(dto.description ?? "")
				.toLowerCase()
				.replace(/[^a-z0-9]/g, "")
				.substring(0, 100),
		].join(":");
		return crypto
			.createHash("sha256")
			.update(normalized)
			.digest("hex")
			.substring(0, 32);
	}

	/**
	 * Decide what a refire of an already-known `dedupKey` should do (#231 R1/R2).
	 * Status-aware: `suppressed` never reopens (suppression is forward-only,
	 * ADR-0028), `resolved` reopens only inside the flap window.
	 */
	private classifyRefire(existing: Alert, now: Date): DedupOutcome {
		if (existing.status === AlertStatus.suppressed) return "counted-suppressed";
		if (existing.status !== AlertStatus.resolved) return "counted";

		// resolvedAt is the terminal stamp the window is measured from; a resolved
		// row without one is treated as long-since resolved, not as a flap.
		const resolvedAt = existing.resolvedAt ?? existing.updatedAt;
		const sinceResolved = now.getTime() - resolvedAt.getTime();
		return sinceResolved <= this.flapWindowMs() ? "reopened" : "new-episode";
	}

	/**
	 * Create an alert.
	 *
	 * On a `dedupKey` hit the #231 rulings decide between a counter bump, a flap
	 * reopen, and a brand-new episode row — see `docs/alert-dedup-and-grouping.md`.
	 */
	async create(dto: CreateAlertDto): Promise<Alert> {
		const dedupKey = this.generateDedupKey(dto);
		const fingerprint = this.generateFingerprint(dto);
		const now = new Date();

		// Newest episode wins: dedupKey is no longer unique (#231 R2b), so a
		// findUnique read here would throw once a second episode row exists.
		const existing = await this.prisma.alert.findFirst({
			where: { dedupKey },
			orderBy: { triggeredAt: "desc" },
		});

		if (existing) {
			const outcome = this.classifyRefire(existing, now);

			if (outcome !== "new-episode") {
				const updated = await this.prisma.alert.update({
					where: { id: existing.id },
					data: {
						occurrenceCount: { increment: 1 },
						lastOccurrence: now,
						updatedAt: now,
						...(outcome === "reopened" && {
							status: AlertStatus.triggered,
							resolvedAt: null,
							triggeredAt: now,
						}),
					},
				});

				if (outcome === "reopened") {
					await this.recordFlapReopen(updated, existing.resolvedAt ?? now);
					this.logger.log(
						`Reopened alert ${existing.id} by refire within the flap window (${updated.occurrenceCount} occurrences)`,
					);
				} else {
					this.logger.log(
						`Deduplicated alert ${existing.id} (${updated.occurrenceCount} occurrences, status ${updated.status})`,
					);
				}
				return updated;
			}

			this.logger.log(
				`Refire of resolved alert ${existing.id} landed outside the flap window — opening a new episode`,
			);
		}

		const alert = await this.prisma.alert.create({
			data: {
				source: dto.source ?? "api",
				externalId: dto.sourceAlertId,
				dedupKey,
				fingerprint,
				severity: dto.severity ?? "medium",
				title: dto.title,
				description: dto.description ?? "",
				sourceUrl: dto.sourceUrl,
				rawPayload: dto.rawPayload ? JSON.stringify(dto.rawPayload) : null,
				tags: dto.tags ? JSON.stringify(dto.tags) : null,
				labels: dto.labels ? JSON.stringify(dto.labels) : null,
				serviceId: dto.serviceId,
				status: "triggered",
				triggeredAt: new Date(),
				occurrenceCount: 1,
				lastOccurrence: new Date(),
			},
		});

		this.logger.log(`Created alert ${alert.id}: ${alert.title}`);
		return alert;
	}

	/**
	 * Find alert by ID with relations
	 */
	async findById(id: string): Promise<AlertWithRelations | null> {
		return this.prisma.alert.findUnique({
			where: { id },
			include: {
				incident: {
					select: {
						id: true,
						number: true,
						title: true,
						status: true,
						severity: true,
					},
				},
				service: true,
				events: {
					select: {
						id: true,
						source: true,
						eventType: true,
						receivedAt: true,
					},
					orderBy: { receivedAt: "desc" },
					take: 10,
				},
			},
		});
	}

	/**
	 * Append the "reopened by refire (flap)" timeline entry to the alert's linked
	 * incident. Advisory: an alert with no incident has nowhere to record it, and
	 * a failed write must not fail the ingest (#231 R1).
	 */
	private async recordFlapReopen(
		alert: Alert,
		resolvedAt: Date,
	): Promise<void> {
		if (!alert.incidentId) return;
		try {
			await this.prisma.timelineEntry.create({
				data: {
					incidentId: alert.incidentId,
					type: TimelineEntryType.status_changed,
					title: "Alert reopened by refire (flap)",
					description: `Alert "${alert.title}" refired ${Math.round((alert.lastOccurrence.getTime() - resolvedAt.getTime()) / 1000)}s after resolving, inside the flap window, and was reopened as occurrence ${alert.occurrenceCount}.`,
					metadata: JSON.stringify({
						alertId: alert.id,
						dedupKey: alert.dedupKey,
						occurrenceCount: alert.occurrenceCount,
						resolvedAt: resolvedAt.toISOString(),
						reason: "flap",
					}),
					source: TimelineSource.system,
					occurredAt: alert.lastOccurrence,
				},
			});
		} catch (error) {
			this.logger.warn(
				`Failed to record flap reopen on incident ${alert.incidentId}: ${error}`,
			);
		}
	}

	/**
	 * Find the newest alert episode for a dedupKey (#231 R2b — the key is no
	 * longer unique, so this reads the latest row rather than the only one).
	 */
	async findByDedupKey(dedupKey: string): Promise<Alert | null> {
		return this.prisma.alert.findFirst({
			where: { dedupKey },
			orderBy: { triggeredAt: "desc" },
		});
	}

	/**
	 * Find the newest alert episode for a source alert ID (#231 — externalId is
	 * no longer unique, so this reads the latest row rather than the only one).
	 */
	async findBySourceAlertId(sourceAlertId: string): Promise<Alert | null> {
		return this.prisma.alert.findFirst({
			where: { externalId: sourceAlertId },
			orderBy: { triggeredAt: "desc" },
		});
	}

	/**
	 * Find all alerts with filters
	 */
	async findAll(options?: {
		status?: string;
		severity?: string;
		serviceId?: string;
		incidentId?: string;
		hasIncident?: boolean;
		unassigned?: boolean;
		limit?: number;
		offset?: number;
	}): Promise<{ data: AlertWithRelations[]; total: number }> {
		// `unassigned` is the sole definition of the dashboard's "Unassigned" set,
		// intersected with an explicit `status` so neither filter silently wins.
		const unassignedStatuses = options?.unassigned
			? UNASSIGNED_ALERT_STATUSES.filter(
					(s) => options.status === undefined || s === options.status,
				)
			: undefined;

		const where = {
			...(unassignedStatuses
				? { status: { in: unassignedStatuses } }
				: options?.status && { status: options.status }),
			...(options?.severity && { severity: options.severity }),
			...(options?.serviceId && { serviceId: options.serviceId }),
			// All three write `incidentId`, so precedence is explicit: `unassigned`
			// (a row with an incident is never unassigned) outranks a specific
			// incidentId, which outranks the coarser hasIncident.
			...(options?.unassigned
				? { incidentId: null }
				: options?.incidentId
					? { incidentId: options.incidentId }
					: options?.hasIncident !== undefined && {
							incidentId: options.hasIncident ? { not: null } : null,
						}),
		};

		const [data, total] = await Promise.all([
			this.prisma.alert.findMany({
				where,
				include: {
					incident: {
						select: {
							id: true,
							number: true,
							title: true,
							status: true,
							severity: true,
						},
					},
					service: true,
				},
				orderBy: { triggeredAt: "desc" },
				take: options?.limit,
				skip: options?.offset,
			}),
			this.prisma.alert.count({ where }),
		]);

		return { data, total };
	}

	/**
	 * Find uncorrelated alerts (not linked to any incident)
	 */
	async findUncorrelated(limit: number = 100): Promise<Alert[]> {
		return this.prisma.alert.findMany({
			where: {
				incidentId: null,
				status: "triggered",
			},
			orderBy: { triggeredAt: "asc" },
			take: limit,
		});
	}

	/**
	 * Update an alert
	 */
	async update(id: string, dto: UpdateAlertDto): Promise<Alert | null> {
		try {
			const updateData: Record<string, unknown> = {
				...dto,
				updatedAt: new Date(),
			};

			if (dto.tags) {
				updateData.tags = JSON.stringify(dto.tags);
			}

			const alert = await this.prisma.alert.update({
				where: { id },
				data: updateData,
			});

			this.logger.log(`Updated alert ${id}`);
			return alert;
		} catch {
			return null;
		}
	}

	/**
	 * Update alert status
	 */
	async updateStatus(id: string, status: string): Promise<Alert | null> {
		const updateData: Record<string, unknown> = {
			status,
			updatedAt: new Date(),
		};

		if (status === "acknowledged") {
			updateData.acknowledgedAt = new Date();
		}
		if (status === "resolved") {
			updateData.resolvedAt = new Date();
		}

		try {
			return await this.prisma.alert.update({
				where: { id },
				data: updateData,
			});
		} catch {
			return null;
		}
	}

	/**
	 * Acknowledge an alert
	 */
	async acknowledge(id: string): Promise<Alert | null> {
		return this.updateStatus(id, "acknowledged");
	}

	/**
	 * Resolve an alert
	 */
	async resolve(id: string): Promise<Alert | null> {
		return this.updateStatus(id, "resolved");
	}

	/**
	 * Delete an alert
	 */
	async delete(id: string): Promise<boolean> {
		try {
			await this.prisma.alert.delete({
				where: { id },
			});
			this.logger.log(`Deleted alert ${id}`);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Count alerts
	 */
	async count(options?: {
		status?: string;
		severity?: string;
		hasIncident?: boolean;
	}): Promise<number> {
		return this.prisma.alert.count({
			where: {
				...(options?.status && { status: options.status }),
				...(options?.severity && { severity: options.severity }),
				...(options?.hasIncident !== undefined && {
					incidentId: options.hasIncident ? { not: null } : null,
				}),
			},
		});
	}

	/**
	 * Get alert statistics
	 */
	async getStats(): Promise<{
		total: number;
		byStatus: Record<string, number>;
		bySeverity: Record<string, number>;
		uncorrelated: number;
	}> {
		const [total, byStatus, bySeverity, uncorrelated] = await Promise.all([
			this.prisma.alert.count(),
			this.prisma.alert.groupBy({
				by: ["status"],
				_count: true,
			}),
			this.prisma.alert.groupBy({
				by: ["severity"],
				_count: true,
			}),
			this.prisma.alert.count({
				where: { incidentId: null },
			}),
		]);

		return {
			total,
			byStatus: byStatus.reduce(
				(acc, item) => {
					acc[item.status] = item._count;
					return acc;
				},
				{} as Record<string, number>,
			),
			bySeverity: bySeverity.reduce(
				(acc, item) => {
					acc[item.severity] = item._count;
					return acc;
				},
				{} as Record<string, number>,
			),
			uncorrelated,
		};
	}
}
