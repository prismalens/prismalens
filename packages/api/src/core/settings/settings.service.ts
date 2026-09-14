// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class SettingsService {
	constructor(private prisma: PrismaService) {}

	// =============================================================================
	// INVESTIGATION POLICIES (read-only: #628 deleted the settings tab and the
	// write routes — nothing can persist a row anymore — but
	// `InvestigationTriggerService` still calls this directly, in-process, to
	// decide whether an alert correlation auto-starts an investigation. That
	// read path is independent of the oRPC contract this issue removed.)
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

	/** Defaults only: nothing writes a stored policy any more, so a leftover row must not steer triggers. */
	async getInvestigationPolicies() {
		return { policies: Object.values(this.DEFAULT_POLICIES) };
	}

	// =============================================================================
	// DANGER ZONE OPERATIONS
	// =============================================================================

	async resetData() {
		await this.prisma.$transaction([
			this.prisma.recommendation.deleteMany({}),
			this.prisma.investigation.deleteMany({}),
			this.prisma.timelineEntry.deleteMany({}),
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
			this.prisma.investigation.deleteMany({}),
			this.prisma.timelineEntry.deleteMany({}),
			this.prisma.changeEvent.deleteMany({}),
			// Incident/Alert (after investigations, timelines)
			this.prisma.incident.deleteMany({}),
			this.prisma.alert.deleteMany({}),
			this.prisma.event.deleteMany({}),
			// Service hierarchy
			this.prisma.serviceIntegration.deleteMany({}),
			this.prisma.serviceDependency.deleteMany({}),
			this.prisma.service.deleteMany({}),
			// Integrations (after serviceIntegrations)
			this.prisma.connection.deleteMany({}),
			this.prisma.setting.deleteMany({}),
			// Auth tables (after sessions → after users)
			this.prisma.session.deleteMany({}),
			this.prisma.account.deleteMany({}),
			this.prisma.verification.deleteMany({}),
			this.prisma.user.deleteMany({}),
		]);

		return { success: true, message: "Factory reset complete" };
	}
}
