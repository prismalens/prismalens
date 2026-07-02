import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import type { Alert, CorrelationRule, Incident } from "@prismalens/database";
import * as crypto from "crypto";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { IncidentsService } from "../incidents/incidents.service.js";
import {
	CreateCorrelationRuleDto,
	UpdateCorrelationRuleDto,
} from "./dto/index.js";

export type { CorrelationRule };

export interface CorrelationResult {
	matched: boolean;
	incidentId?: string;
	incidentNumber?: number;
	reason?: string;
	ruleId?: string;
	ruleName?: string;
	isNewIncident: boolean;
}

interface MatchCriteria {
	match?: {
		tags?: string[];
		severity?: string[];
		service?: string;
		source?: string;
	};
}

@Injectable()
export class CorrelationService {
	private readonly logger = new Logger(CorrelationService.name);

	constructor(
		private readonly prisma: PrismaService,
		@Inject(forwardRef(() => IncidentsService))
		private readonly incidentsService: IncidentsService,
	) {}

	/**
	 * Create a correlation rule
	 */
	async createRule(dto: CreateCorrelationRuleDto): Promise<CorrelationRule> {
		const rule = await this.prisma.correlationRule.create({
			data: {
				name: dto.name,
				description: dto.description,
				enabled: dto.enabled ?? true,
				priority: dto.priority ?? 100,
				matchCriteria: JSON.stringify(dto.matchCriteria),
				timeWindowMinutes: dto.timeWindowMinutes ?? 60,
				action: dto.action ?? "correlate",
			},
		});

		this.logger.log(`Created correlation rule: ${rule.name}`);
		return rule;
	}

	/**
	 * Find all correlation rules
	 */
	async findAllRules(options?: {
		enabled?: boolean;
	}): Promise<CorrelationRule[]> {
		return this.prisma.correlationRule.findMany({
			where: {
				...(options?.enabled !== undefined && { enabled: options.enabled }),
			},
			orderBy: { priority: "asc" },
		});
	}

	/**
	 * Find rule by ID
	 */
	async findRuleById(id: string): Promise<CorrelationRule | null> {
		return this.prisma.correlationRule.findUnique({
			where: { id },
		});
	}

	/**
	 * Update a correlation rule
	 */
	async updateRule(
		id: string,
		dto: UpdateCorrelationRuleDto,
	): Promise<CorrelationRule | null> {
		try {
			const updateData: Record<string, unknown> = {
				...dto,
				updatedAt: new Date(),
			};

			if (dto.matchCriteria) {
				updateData.matchCriteria = JSON.stringify(dto.matchCriteria);
			}

			return await this.prisma.correlationRule.update({
				where: { id },
				data: updateData,
			});
		} catch {
			return null;
		}
	}

	/**
	 * Delete a correlation rule
	 */
	async deleteRule(id: string): Promise<boolean> {
		try {
			await this.prisma.correlationRule.delete({
				where: { id },
			});
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Generate dedup key for an alert
	 */
	generateDedupKey(alert: {
		source?: string | null;
		title: string;
		severity: string;
		serviceId?: string | null;
	}): string {
		const input = `${alert.source ?? "unknown"}:${alert.title}:${alert.severity}:${alert.serviceId ?? ""}`;
		return crypto
			.createHash("sha256")
			.update(input)
			.digest("hex")
			.substring(0, 32);
	}

	/**
	 * Generate fingerprint for similarity matching
	 */
	generateFingerprint(alert: {
		title: string;
		description?: string | null;
		tags?: string | null;
	}): string {
		// Normalize and combine key fields for fingerprinting
		const normalized = [
			alert.title.toLowerCase().replace(/[^a-z0-9]/g, ""),
			(alert.description ?? "")
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
	 * Correlate an alert to an incident
	 * Returns the incident (existing or new) the alert should be linked to
	 */
	async correlateAlert(alert: Alert): Promise<CorrelationResult> {
		// 1. First try rule-based correlation
		const ruleResult = await this.matchToIncidentByRules(alert);
		if (ruleResult.matched) {
			return ruleResult;
		}

		// 2. Try fingerprint-based correlation
		const fingerprintResult = await this.matchToIncidentByFingerprint(alert);
		if (fingerprintResult.matched) {
			return fingerprintResult;
		}

		// 3. Try time-window based correlation (same service, similar time)
		const timeWindowResult = await this.matchToIncidentByTimeWindow(alert);
		if (timeWindowResult.matched) {
			return timeWindowResult;
		}

		// 4. No match - create new incident
		const incident = await this.incidentsService.create({
			title: alert.title,
			description: alert.description ?? undefined,
			severity: alert.severity as
				| "critical"
				| "high"
				| "medium"
				| "low"
				| "info",
			serviceId: alert.serviceId ?? undefined,
			correlationReason: "New alert - no matching incident found",
		});

		// Link alert to incident
		await this.incidentsService.addAlert(incident.id, alert.id);

		return {
			matched: true,
			incidentId: incident.id,
			incidentNumber: incident.number,
			reason: "Created new incident",
			isNewIncident: true,
		};
	}

	/**
	 * Match alert to incident using correlation rules
	 */
	private async matchToIncidentByRules(
		alert: Alert,
	): Promise<CorrelationResult> {
		const rules = await this.findAllRules({ enabled: true });

		for (const rule of rules) {
			if (this.alertMatchesRule(alert, rule)) {
				if (rule.action === "suppress") {
					return {
						matched: false,
						reason: `Suppressed by rule: ${rule.name}`,
						ruleId: rule.id,
						ruleName: rule.name,
						isNewIncident: false,
					};
				}

				// Find existing incident within time window that matches the rule
				const incident = await this.findMatchingIncident(alert, rule);

				if (incident) {
					// Add alert to existing incident
					await this.incidentsService.addAlert(incident.id, alert.id);

					// Update the incident to reference the correlation rule
					await this.prisma.incident.update({
						where: { id: incident.id },
						data: { correlationRuleId: rule.id },
					});

					return {
						matched: true,
						incidentId: incident.id,
						incidentNumber: incident.number,
						reason: `Matched by rule: ${rule.name}`,
						ruleId: rule.id,
						ruleName: rule.name,
						isNewIncident: false,
					};
				}
			}
		}

		return { matched: false, isNewIncident: false };
	}

	/**
	 * Check if an alert matches a correlation rule
	 */
	private alertMatchesRule(alert: Alert, rule: CorrelationRule): boolean {
		try {
			const criteria = JSON.parse(rule.matchCriteria) as MatchCriteria;

			if (!criteria.match) return false;

			// Check tags
			if (criteria.match.tags && criteria.match.tags.length > 0) {
				const alertTags = alert.tags
					? (JSON.parse(alert.tags) as string[])
					: [];
				const hasMatchingTag = criteria.match.tags.some((t) =>
					alertTags.includes(t),
				);
				if (!hasMatchingTag) return false;
			}

			// Check severity
			if (criteria.match.severity && criteria.match.severity.length > 0) {
				if (!criteria.match.severity.includes(alert.severity)) return false;
			}

			// Check service
			if (criteria.match.service) {
				if (alert.serviceId !== criteria.match.service) return false;
			}

			// Check source
			if (criteria.match.source) {
				if (alert.source !== criteria.match.source) return false;
			}

			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Find an existing incident that matches the rule criteria
	 */
	private async findMatchingIncident(
		alert: Alert,
		rule: CorrelationRule,
	): Promise<Incident | null> {
		const timeWindowStart = new Date(
			Date.now() - rule.timeWindowMinutes * 60 * 1000,
		);

		return this.prisma.incident.findFirst({
			where: {
				status: { notIn: ["resolved", "closed"] },
				triggeredAt: { gte: timeWindowStart },
				...(alert.serviceId && { serviceId: alert.serviceId }),
			},
			orderBy: { triggeredAt: "desc" },
		});
	}

	/**
	 * Match alert to incident by fingerprint similarity
	 */
	private async matchToIncidentByFingerprint(
		alert: Alert,
	): Promise<CorrelationResult> {
		if (!alert.fingerprint) {
			return { matched: false, isNewIncident: false };
		}

		// Find alerts with same fingerprint in recent time window (60 min)
		const timeWindowStart = new Date(Date.now() - 60 * 60 * 1000);

		const similarAlert = await this.prisma.alert.findFirst({
			where: {
				fingerprint: alert.fingerprint,
				id: { not: alert.id },
				incidentId: { not: null },
				triggeredAt: { gte: timeWindowStart },
			},
			include: {
				incident: true,
			},
			orderBy: { triggeredAt: "desc" },
		});

		if (similarAlert?.incident) {
			await this.incidentsService.addAlert(similarAlert.incident.id, alert.id);

			return {
				matched: true,
				incidentId: similarAlert.incident.id,
				incidentNumber: similarAlert.incident.number,
				reason: "Matched by fingerprint similarity",
				isNewIncident: false,
			};
		}

		return { matched: false, isNewIncident: false };
	}

	/**
	 * Match alert to incident by time window and service
	 */
	private async matchToIncidentByTimeWindow(
		alert: Alert,
	): Promise<CorrelationResult> {
		const timeWindowStart = new Date(Date.now() - 60 * 60 * 1000);

		// Find recent open incident for same service
		const incident = await this.prisma.incident.findFirst({
			where: {
				status: { notIn: ["resolved", "closed"] },
				triggeredAt: { gte: timeWindowStart },
				...(alert.serviceId && { serviceId: alert.serviceId }),
			},
			orderBy: { triggeredAt: "desc" },
		});

		if (incident) {
			await this.incidentsService.addAlert(incident.id, alert.id);

			return {
				matched: true,
				incidentId: incident.id,
				incidentNumber: incident.number,
				reason: "Matched by time window correlation",
				isNewIncident: false,
			};
		}

		return { matched: false, isNewIncident: false };
	}
}
