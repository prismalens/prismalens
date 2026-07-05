// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable, Logger } from "@nestjs/common";
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

	async findAll(): Promise<AlertMappingRule[]> {
		return this.prisma.alertMappingRule.findMany({
			where: { enabled: true },
			orderBy: { priority: "asc" },
		});
	}

	async findById(id: string): Promise<AlertMappingRule | null> {
		return this.prisma.alertMappingRule.findUnique({
			where: { id },
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
	 * Resolve which service an alert should map to based on mapping rules.
	 * Rules are evaluated in priority order (lower number = higher priority).
	 * Returns null if no rule matches.
	 */
	async resolveServiceForAlert(alert: AlertInfo): Promise<Service | null> {
		const rules = await this.findAll();

		this.logger.debug(
			`Resolving service for alert: "${alert.title}" (${alert.source || "unknown"}), ` +
				`${rules.length} active rules`,
		);

		for (const rule of rules) {
			if (this.matchesRule(alert, rule)) {
				this.logger.log(
					`Alert "${alert.title}" matched rule "${rule.name}" → service ${rule.serviceId}`,
				);

				// Fetch the service
				const service = await this.prisma.service.findUnique({
					where: { id: rule.serviceId },
				});

				return service;
			}
		}

		this.logger.debug(`Alert "${alert.title}" did not match any rules`);
		return null;
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
}
