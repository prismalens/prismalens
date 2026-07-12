// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class SettingsService {
	constructor(private prisma: PrismaService) {}

	// =============================================================================
	// INVESTIGATION POLICIES
	// =============================================================================

	private readonly DEFAULT_POLICIES = {
		tier_1: {
			tier: "tier_1" as const,
			autoInvestigate: "always" as const,
			requiresApproval: true,
			pageOnCall: true,
			postToSlack: true,
			triggerOnAlertCount: 3,
			triggerOnSeverities: ["critical", "high"] as ("critical" | "high")[],
			triggerDelayMinutes: 2,
			reInvestigateOnNewAlerts: true,
			reInvestigateThreshold: 3,
		},
		tier_2: {
			tier: "tier_2" as const,
			autoInvestigate: "critical_high" as const,
			requiresApproval: false,
			pageOnCall: false,
			postToSlack: true,
			triggerOnAlertCount: 5,
			triggerOnSeverities: ["critical"] as ("critical" | "high")[],
			triggerDelayMinutes: 5,
			reInvestigateOnNewAlerts: false,
			reInvestigateThreshold: 5,
		},
		tier_3: {
			tier: "tier_3" as const,
			autoInvestigate: "manual" as const,
			requiresApproval: false,
			pageOnCall: false,
			postToSlack: true,
			triggerOnAlertCount: 10,
			triggerOnSeverities: ["critical"] as ("critical" | "high")[],
			triggerDelayMinutes: 10,
			reInvestigateOnNewAlerts: false,
			reInvestigateThreshold: 10,
		},
		tier_4: {
			tier: "tier_4" as const,
			autoInvestigate: "never" as const,
			requiresApproval: false,
			pageOnCall: false,
			postToSlack: false,
			triggerOnAlertCount: 20,
			triggerOnSeverities: [] as ("critical" | "high")[],
			triggerDelayMinutes: 15,
			reInvestigateOnNewAlerts: false,
			reInvestigateThreshold: 20,
		},
	};

	private readonly DEFAULT_LIMITS = {
		maxConcurrent: 5,
		timeoutMinutes: 30,
		maxToolCalls: 50,
	};

	private static readonly VALID_TIERS = new Set([
		"tier_1",
		"tier_2",
		"tier_3",
		"tier_4",
	]);

	async getInvestigationPolicies() {
		const setting = await this.prisma.setting.findUnique({
			where: { key: "INVESTIGATION_POLICIES" },
		});

		if (!setting) {
			return {
				policies: Object.values(this.DEFAULT_POLICIES),
			};
		}

		let saved: Record<string, unknown>;
		try {
			saved = JSON.parse(setting.value);
		} catch {
			saved = {};
		}
		const policies = Object.keys(this.DEFAULT_POLICIES).map((tier) => ({
			...this.DEFAULT_POLICIES[tier as keyof typeof this.DEFAULT_POLICIES],
			...((saved[tier] as Record<string, unknown>) || {}),
			tier: tier as "tier_1" | "tier_2" | "tier_3" | "tier_4",
		}));

		return { policies };
	}

	async updateInvestigationPolicy(
		tier: string,
		dto: {
			autoInvestigate?: string;
			requiresApproval?: boolean;
			pageOnCall?: boolean;
			postToSlack?: boolean;
			triggerOnAlertCount?: number;
			triggerOnSeverities?: ("critical" | "high")[];
			triggerDelayMinutes?: number;
			reInvestigateOnNewAlerts?: boolean;
			reInvestigateThreshold?: number;
		},
	) {
		if (!SettingsService.VALID_TIERS.has(tier)) {
			throw new BadRequestException(`Invalid tier: ${tier}`);
		}

		const setting = await this.prisma.setting.findUnique({
			where: { key: "INVESTIGATION_POLICIES" },
		});

		let current: Record<string, any>;
		if (setting) {
			try {
				current = JSON.parse(setting.value);
			} catch {
				current = { ...this.DEFAULT_POLICIES };
			}
		} else {
			current = { ...this.DEFAULT_POLICIES };
		}

		current[tier] = {
			...(current[tier] ||
				this.DEFAULT_POLICIES[tier as keyof typeof this.DEFAULT_POLICIES]),
			...dto,
			tier,
		};

		await this.prisma.setting.upsert({
			where: { key: "INVESTIGATION_POLICIES" },
			update: { value: JSON.stringify(current), type: "json", category: "ai" },
			create: {
				key: "INVESTIGATION_POLICIES",
				value: JSON.stringify(current),
				type: "json",
				category: "ai",
			},
		});

		return current[tier];
	}

	async getInvestigationLimits() {
		const setting = await this.prisma.setting.findUnique({
			where: { key: "INVESTIGATION_LIMITS" },
		});

		if (!setting) {
			return this.DEFAULT_LIMITS;
		}

		try {
			return {
				...this.DEFAULT_LIMITS,
				...JSON.parse(setting.value),
			};
		} catch {
			return this.DEFAULT_LIMITS;
		}
	}

	async updateInvestigationLimits(dto: {
		maxConcurrent?: number;
		timeoutMinutes?: number;
		maxToolCalls?: number;
	}) {
		const current = await this.getInvestigationLimits();
		const updated = { ...current, ...dto };

		await this.prisma.setting.upsert({
			where: { key: "INVESTIGATION_LIMITS" },
			update: { value: JSON.stringify(updated), type: "json", category: "ai" },
			create: {
				key: "INVESTIGATION_LIMITS",
				value: JSON.stringify(updated),
				type: "json",
				category: "ai",
			},
		});

		return updated;
	}

	// =============================================================================
	// DANGER ZONE OPERATIONS
	// =============================================================================

	async resetData() {
		await this.prisma.$transaction([
			this.prisma.recommendation.deleteMany({}),
			this.prisma.toolExecution.deleteMany({}),
			this.prisma.agentExecution.deleteMany({}),
			this.prisma.investigation.deleteMany({}),
			this.prisma.timelineEntry.deleteMany({}),
			this.prisma.postmortem.deleteMany({}),
			this.prisma.incident.deleteMany({}),
			this.prisma.alert.deleteMany({}),
			this.prisma.event.deleteMany({}),
		]);

		return { success: true, message: "All data has been reset" };
	}

	async factoryReset() {
		// FK-safe deletion order: children before parents.
		// Includes auth tables so setup wizard can be re-entered after reset.
		await this.prisma.$transaction([
			// Deep children first (no dependents)
			this.prisma.recommendation.deleteMany({}),
			this.prisma.toolExecution.deleteMany({}),
			this.prisma.agentExecution.deleteMany({}),
			this.prisma.investigation.deleteMany({}),
			this.prisma.timelineEntry.deleteMany({}),
			this.prisma.postmortem.deleteMany({}),
			this.prisma.changeEvent.deleteMany({}),
			// Incident/Alert (after investigations, timelines, postmortems)
			this.prisma.incident.deleteMany({}),
			this.prisma.alert.deleteMany({}),
			this.prisma.event.deleteMany({}),
			// Service hierarchy
			this.prisma.serviceSuggestion.deleteMany({}),
			this.prisma.serviceIntegration.deleteMany({}),
			this.prisma.serviceDependency.deleteMany({}),
			this.prisma.alertMappingRule.deleteMany({}),
			this.prisma.service.deleteMany({}),
			// Integrations (after serviceIntegrations)
			this.prisma.oAuthState.deleteMany({}),
			this.prisma.connection.deleteMany({}),
			this.prisma.correlationRule.deleteMany({}),
			this.prisma.setting.deleteMany({}),
			// Auth tables (after sessions → after users)
			this.prisma.invitation.deleteMany({}),
			this.prisma.member.deleteMany({}),
			this.prisma.organization.deleteMany({}),
			this.prisma.session.deleteMany({}),
			this.prisma.account.deleteMany({}),
			this.prisma.verification.deleteMany({}),
			this.prisma.user.deleteMany({}),
		]);

		return { success: true, message: "Factory reset complete" };
	}
}
