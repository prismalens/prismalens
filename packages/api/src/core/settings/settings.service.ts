// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

/** Raised inside the reset transaction, so a run that starts mid-reset still stops it. */
export class ActiveRunsError extends Error {
	constructor(readonly count: number) {
		super(
			`${count} investigation(s) are queued or running. Cancel them, or wait for them to finish, then reset.`,
		);
		this.name = "ActiveRunsError";
	}
}

@Injectable()
export class SettingsService {
	constructor(private prisma: PrismaService) {}

	// =============================================================================
	// DANGER ZONE OPERATIONS
	// =============================================================================

	/** Investigations queued or running; a reset under them deletes rows a run is still writing (#605 edge 28). */
	async activeRunCount(): Promise<number> {
		return this.prisma.investigation.count({
			where: { status: { in: ["pending", "running"] } },
		});
	}

	/**
	 * The same count, inside the caller's transaction. Checking before the
	 * transaction is a check-then-act: a run claimed between the count and the
	 * deletes would have its rows deleted underneath it (#662 review). SQLite is
	 * serializable, so a count inside the transaction that deletes is decisive.
	 */
	private async refuseIfRunning(tx: {
		investigation: { count: (args: unknown) => Promise<number> };
	}): Promise<void> {
		const active = await tx.investigation.count({
			where: { status: { in: ["pending", "running"] } },
		});
		if (active > 0) throw new ActiveRunsError(active);
	}

	async resetData() {
		await this.prisma.$transaction(async (tx) => {
			await this.refuseIfRunning(tx as never);
			await tx.recommendation.deleteMany({});
			await tx.investigation.deleteMany({});
			await tx.timelineEntry.deleteMany({});
			await tx.incident.deleteMany({});
			await tx.alert.deleteMany({});
			await tx.event.deleteMany({});
		});

		return { success: true, message: "All data has been reset" };
	}

	async factoryReset() {
		// FK-safe deletion order: children before parents.
		// Includes auth tables so setup wizard can be re-entered after reset.
		await this.prisma.$transaction(async (tx) => {
			await this.refuseIfRunning(tx as never);
			// Deep children first (no dependents)
			await tx.recommendation.deleteMany({});
			await tx.investigation.deleteMany({});
			await tx.timelineEntry.deleteMany({});
			await tx.changeEvent.deleteMany({});
			// Incident/Alert (after investigations, timelines)
			await tx.incident.deleteMany({});
			await tx.alert.deleteMany({});
			await tx.event.deleteMany({});
			// Service hierarchy
			await tx.serviceIntegration.deleteMany({});
			await tx.serviceDependency.deleteMany({});
			await tx.service.deleteMany({});
			// Integrations (after serviceIntegrations)
			await tx.connection.deleteMany({});
			await tx.setting.deleteMany({});
			// Auth tables (after sessions -> after users)
			await tx.session.deleteMany({});
			await tx.account.deleteMany({});
			await tx.verification.deleteMany({});
			await tx.user.deleteMany({});
		});

		return { success: true, message: "Factory reset complete" };
	}
}
