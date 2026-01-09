import { Injectable, Logger } from "@nestjs/common";
import type { Alert } from "@prismalens/database";
import * as crypto from "crypto";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { CreateAlertDto, UpdateAlertDto } from "./dto/index.js";

export { CreateAlertDto, UpdateAlertDto };
export type { Alert };

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

	constructor(private readonly prisma: PrismaService) {}

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
	 * Create an alert
	 */
	async create(dto: CreateAlertDto): Promise<Alert> {
		const dedupKey = this.generateDedupKey(dto);
		const fingerprint = this.generateFingerprint(dto);

		// Check for duplicate by dedupKey
		const existing = await this.prisma.alert.findUnique({
			where: { dedupKey },
		});

		if (existing) {
			// Update occurrence count and last seen
			const updated = await this.prisma.alert.update({
				where: { id: existing.id },
				data: {
					occurrenceCount: { increment: 1 },
					lastOccurrence: new Date(),
					updatedAt: new Date(),
				},
			});
			this.logger.log(
				`Deduplicated alert ${existing.id} (${updated.occurrenceCount} occurrences)`,
			);
			return updated;
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
					},
				},
				service: {
					select: {
						id: true,
						name: true,
						displayName: true,
					},
				},
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
	 * Find alert by dedupKey
	 */
	async findByDedupKey(dedupKey: string): Promise<Alert | null> {
		return this.prisma.alert.findUnique({
			where: { dedupKey },
		});
	}

	/**
	 * Find alert by source alert ID
	 */
	async findBySourceAlertId(sourceAlertId: string): Promise<Alert | null> {
		return this.prisma.alert.findUnique({
			where: { externalId: sourceAlertId },
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
		limit?: number;
		offset?: number;
	}): Promise<AlertWithRelations[]> {
		return this.prisma.alert.findMany({
			where: {
				...(options?.status && { status: options.status }),
				...(options?.severity && { severity: options.severity }),
				...(options?.serviceId && { serviceId: options.serviceId }),
				...(options?.incidentId && { incidentId: options.incidentId }),
				...(options?.hasIncident !== undefined && {
					incidentId: options.hasIncident ? { not: null } : null,
				}),
			},
			include: {
				incident: {
					select: {
						id: true,
						number: true,
						title: true,
						status: true,
					},
				},
				service: {
					select: {
						id: true,
						name: true,
						displayName: true,
					},
				},
			},
			orderBy: { triggeredAt: "desc" },
			take: options?.limit,
			skip: options?.offset,
		});
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
