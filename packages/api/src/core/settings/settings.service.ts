// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class SettingsService {
	constructor(private prisma: PrismaService) {}

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
