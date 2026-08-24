// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, Logger } from "@nestjs/common";
import type {
	AlertMappingHealthIssue,
	AlertMappingHealthResponse,
	AlertMappingHealthSummary,
	RuleMappingHealth,
	ServiceMappingHealth,
} from "@prismalens/contracts/schemas";
import { AlertMappingRule, Service } from "@prismalens/database";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { CreateMappingRuleDto, UpdateMappingRuleDto } from "./dto/index.js";

export interface AlertInfo {
	source?: string;
	labels?: Record<string, string>;
	tags?: string[];
	title: string;
	description?: string;
}

@Injectable()
export class AlertMappingService {
	private readonly logger = new Logger(AlertMappingService.name);

	constructor(private readonly prisma: PrismaService) {}

	// =========================================================================
	// CRUD OPERATIONS
	// =========================================================================

	async create(dto: CreateMappingRuleDto): Promise<AlertMappingRule> {
		const matchCriteria =
			typeof dto.matchCriteria === "string"
				? dto.matchCriteria
				: JSON.stringify(dto.matchCriteria);

		return this.prisma.alertMappingRule.create({
			data: {
				name: dto.name,
				description: dto.description,
				priority: dto.priority ?? 100,
				enabled: dto.enabled ?? true,
				matchCriteria,
				serviceId: dto.serviceId,
			},
		});
	}

	/**
	 * Filters are opt-in: evaluation asks for `{ enabled: true }`, management
	 * asks for everything. An unconditional enabled filter here would hide a
	 * disabled rule from `/rules`, leaving no way to switch it back on (#294).
	 */
	async findAll(options?: {
		enabled?: boolean;
		serviceId?: string;
	}): Promise<(AlertMappingRule & { service?: Service | null })[]> {
		return this.prisma.alertMappingRule.findMany({
			where: {
				...(options?.enabled !== undefined && { enabled: options.enabled }),
				...(options?.serviceId !== undefined && {
					serviceId: options.serviceId,
				}),
			},
			include: { service: true },
			orderBy: { priority: "asc" },
		});
	}

	async findById(
		id: string,
	): Promise<(AlertMappingRule & { service?: Service | null }) | null> {
		return this.prisma.alertMappingRule.findUnique({
			where: { id },
			include: { service: true },
		});
	}

	async update(
		id: string,
		dto: UpdateMappingRuleDto,
	): Promise<AlertMappingRule> {
		const updateData: Record<string, unknown> = {};

		if (dto.name) updateData.name = dto.name;
		if (dto.description !== undefined) updateData.description = dto.description;
		if (dto.priority !== undefined) updateData.priority = dto.priority;
		if (dto.enabled !== undefined) updateData.enabled = dto.enabled;
		if (dto.matchCriteria) {
			updateData.matchCriteria =
				typeof dto.matchCriteria === "string"
					? dto.matchCriteria
					: JSON.stringify(dto.matchCriteria);
		}
		if (dto.serviceId) updateData.serviceId = dto.serviceId;
		updateData.updatedAt = new Date();

		return this.prisma.alertMappingRule.update({
			where: { id },
			data: updateData,
		});
	}

	async delete(id: string): Promise<void> {
		await this.prisma.alertMappingRule.delete({
			where: { id },
		});
	}

	// =========================================================================
	// ALERT MAPPING LOGIC
	// =========================================================================

	/**
	 * Resolve mapping rule and service for an alert.
	 */
	async resolveMappingForAlert(alert: AlertInfo): Promise<{
		rule: (AlertMappingRule & { service?: Service | null }) | null;
		service: Service | null;
	}> {
		const rules = await this.findAll({ enabled: true });

		this.logger.debug(
			`Resolving service for alert: "${alert.title}" (${alert.source || "unknown"}), ` +
				`${rules.length} active rules`,
		);

		for (const rule of rules) {
			if (this.matchesRule(alert, rule)) {
				this.logger.log(
					`Alert "${alert.title}" matched rule "${rule.name}" → service ${rule.serviceId}`,
				);

				const service =
					rule.service ??
					(await this.prisma.service.findUnique({
						where: { id: rule.serviceId },
					}));

				return { rule, service };
			}
		}

		this.logger.debug(`Alert "${alert.title}" did not match any rules`);
		return { rule: null, service: null };
	}

	/**
	 * Resolve which service an alert should map to based on mapping rules.
	 * Rules are evaluated in priority order (lower number = higher priority).
	 * Returns null if no rule matches.
	 */
	async resolveServiceForAlert(alert: AlertInfo): Promise<Service | null> {
		const { service } = await this.resolveMappingForAlert(alert);
		return service;
	}

	/**
	 * Check if an alert matches a rule's criteria.
	 */
	private matchesRule(alert: AlertInfo, rule: AlertMappingRule): boolean {
		try {
			const criteria = JSON.parse(rule.matchCriteria) as Record<
				string,
				unknown
			>;

			// Check source match
			if (criteria.source) {
				if (alert.source !== criteria.source) {
					return false;
				}
			}

			// Check label matches
			if (criteria.labels && typeof criteria.labels === "object") {
				const labelCriteria = criteria.labels as Record<string, unknown>;
				if (!this.matchesLabels(alert.labels || {}, labelCriteria)) {
					return false;
				}
			}

			// Check tag matches
			if (criteria.tags && Array.isArray(criteria.tags)) {
				const ruleTags = criteria.tags as string[];
				const alertTags = alert.tags || [];
				// Alert must have at least one of the specified tags
				if (!ruleTags.some((tag) => alertTags.includes(tag))) {
					return false;
				}
			}

			return true;
		} catch (error) {
			this.logger.error(
				`Error parsing rule criteria for rule ${rule.id}`,
				error,
			);
			return false;
		}
	}

	/**
	 * Check if alert labels match rule label criteria.
	 * Supports simple glob patterns (e.g., "api-*").
	 * Uses simple wildcard matching: * matches any characters.
	 */
	private matchesLabels(
		alertLabels: Record<string, string>,
		ruleLabelCriteria: Record<string, unknown>,
	): boolean {
		for (const [key, pattern] of Object.entries(ruleLabelCriteria)) {
			const alertValue = alertLabels[key];
			if (!alertValue) {
				return false;
			}

			// Simple glob pattern matching
			const patternStr = String(pattern);
			if (!this.matchesPattern(alertValue, patternStr)) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Simple wildcard pattern matching.
	 * * matches any sequence of characters
	 */
	private matchesPattern(value: string, pattern: string): boolean {
		// Convert glob pattern to regex
		// Escape regex special characters except *
		const regexPattern = pattern
			.split("*")
			.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
			.join(".*");

		const regex = new RegExp(`^${regexPattern}$`);
		return regex.test(value);
	}

	/**
	 * Evaluate mapping health across all services and rules (#452).
	 * Dead rules and unmapped services are computed from live evaluation over alerts.
	 */
	async getHealth(options?: {
		windowHours?: number;
	}): Promise<AlertMappingHealthResponse> {
		const windowHours = options?.windowHours ?? 168;
		const now = new Date();
		const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

		const [services, rules, alerts] = await Promise.all([
			this.prisma.service.findMany({ orderBy: { name: "asc" } }),
			this.prisma.alertMappingRule.findMany({
				include: { service: true },
				orderBy: { priority: "asc" },
			}),
			// All-time alert rows are required because rule matching is evaluated in JS
			// and totalMatches separates stopped_matching from never_matched (#452).
			this.prisma.alert.findMany({
				select: {
					id: true,
					source: true,
					labels: true,
					tags: true,
					title: true,
					description: true,
					triggeredAt: true,
				},
				orderBy: { triggeredAt: "desc" },
			}),
		]);

		const parsedAlerts = alerts.map((a) => {
			let labels: Record<string, string> | undefined;
			let tags: string[] | undefined;
			try {
				if (a.labels) labels = JSON.parse(a.labels);
			} catch {}
			try {
				if (a.tags) tags = JSON.parse(a.tags);
			} catch {}
			return {
				id: a.id,
				title: a.title,
				description: a.description ?? undefined,
				source: a.source ?? undefined,
				labels,
				tags,
				triggeredAt: a.triggeredAt,
			};
		});

		const enabledRules = rules.filter((r) => r.enabled);
		const ruleStats = new Map<
			string,
			{
				totalMatches: number;
				windowMatches: number;
				lastMatchedAt: Date | null;
			}
		>();

		for (const rule of rules) {
			ruleStats.set(rule.id, {
				totalMatches: 0,
				windowMatches: 0,
				lastMatchedAt: null,
			});
		}

		for (const alert of parsedAlerts) {
			for (const rule of enabledRules) {
				if (this.matchesRule(alert, rule)) {
					const stats = ruleStats.get(rule.id);
					if (stats) {
						stats.totalMatches += 1;
						if (alert.triggeredAt >= windowStart) {
							stats.windowMatches += 1;
						}
						if (
							!stats.lastMatchedAt ||
							alert.triggeredAt > stats.lastMatchedAt
						) {
							stats.lastMatchedAt = alert.triggeredAt;
						}
					}
					break;
				}
			}
		}

		const issues: AlertMappingHealthIssue[] = [];

		const serviceHealthList: ServiceMappingHealth[] = services.map((svc) => {
			const svcRules = rules.filter((r) => r.serviceId === svc.id);
			const enabledSvcRules = svcRules.filter((r) => r.enabled);
			const hasEnabledRules = enabledSvcRules.length > 0;

			if (!hasEnabledRules) {
				issues.push({
					id: `service-${svc.id}`,
					type: "unmapped_service",
					title: svc.displayName ?? svc.name,
					description: "Service has no enabled alert mapping rules",
					serviceId: svc.id,
					serviceName: svc.name,
				});
			}

			return {
				serviceId: svc.id,
				serviceName: svc.name,
				serviceDisplayName: svc.displayName ?? null,
				hasEnabledRules,
				ruleCount: svcRules.length,
				enabledRuleCount: enabledSvcRules.length,
			};
		});

		const ruleHealthList: RuleMappingHealth[] = rules.map((rule) => {
			const stats = ruleStats.get(rule.id) ?? {
				totalMatches: 0,
				windowMatches: 0,
				lastMatchedAt: null,
			};
			let status: RuleMappingHealth["status"];

			if (!rule.enabled) {
				status = "disabled";
			} else if (stats.totalMatches === 0) {
				status = "never_matched";
				issues.push({
					id: `rule-${rule.id}`,
					type: "never_matched",
					title: rule.name,
					description: "Enabled rule has never matched any alert",
					ruleId: rule.id,
					ruleName: rule.name,
					serviceId: rule.serviceId,
					serviceName: rule.service?.name ?? null,
					lastMatchedAt: null,
				});
			} else if (stats.windowMatches === 0) {
				status = "stopped_matching";
				const lastMatchedIso = stats.lastMatchedAt?.toISOString() ?? null;
				issues.push({
					id: `rule-${rule.id}`,
					type: "stopped_matching",
					title: rule.name,
					description: `No matches in the last ${windowHours} hours (last matched ${lastMatchedIso ?? "unknown"})`,
					ruleId: rule.id,
					ruleName: rule.name,
					serviceId: rule.serviceId,
					serviceName: rule.service?.name ?? null,
					lastMatchedAt: lastMatchedIso,
				});
			} else {
				status = "healthy";
			}

			return {
				ruleId: rule.id,
				ruleName: rule.name,
				serviceId: rule.serviceId,
				serviceName: rule.service?.name ?? null,
				enabled: rule.enabled,
				status,
				totalMatches: stats.totalMatches,
				windowMatches: stats.windowMatches,
				lastMatchedAt: stats.lastMatchedAt
					? stats.lastMatchedAt.toISOString()
					: null,
			};
		});

		const summary: AlertMappingHealthSummary = {
			totalIssues: issues.length,
			unmappedServicesCount: issues.filter((i) => i.type === "unmapped_service")
				.length,
			neverMatchedRulesCount: issues.filter((i) => i.type === "never_matched")
				.length,
			stoppedMatchingRulesCount: issues.filter(
				(i) => i.type === "stopped_matching",
			).length,
			healthyRulesCount: ruleHealthList.filter((r) => r.status === "healthy")
				.length,
			disabledRulesCount: rules.filter((r) => !r.enabled).length,
			totalRules: rules.length,
			totalServices: services.length,
			windowHours,
		};

		return {
			summary,
			issues,
			services: serviceHealthList,
			rules: ruleHealthList,
		};
	}
}
