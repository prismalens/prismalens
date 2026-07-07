// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Proactive token refresh processor.
 * BullMQ repeatable job that refreshes tokens expiring within 10 minutes.
 * Generic — handles all auth modes (OAuth2, GitHub App, etc.).
 */
import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Job, Queue } from "bullmq";
import type { PrismaService } from "../../core/prisma/prisma.service.js";
import type { IntegrationsService } from "./integrations.service.js";

export const TOKEN_REFRESH_QUEUE = "token-refresh";
const JOB_NAME = "refresh-expiring-tokens";

/** Refresh tokens expiring within this window */
const EXPIRY_BUFFER_MS = 10 * 60 * 1000;

/** Max consecutive failures before marking connection broken */
const MAX_CONSECUTIVE_ERRORS = 3;

/** Max connections to refresh per cycle (prevents unbounded queries) */
const BATCH_SIZE = 100;

@Injectable()
@Processor(TOKEN_REFRESH_QUEUE)
export class TokenRefreshProcessor extends WorkerHost implements OnModuleInit {
	private readonly logger = new Logger(TokenRefreshProcessor.name);

	constructor(
		@InjectQueue(TOKEN_REFRESH_QUEUE) private readonly queue: Queue,
		private readonly prisma: PrismaService,
		private readonly integrationsService: IntegrationsService,
	) {
		super();
	}

	async onModuleInit() {
		await this.queue.upsertJobScheduler(
			"token-refresh-scheduler",
			{ every: 15 * 60 * 1000 },
			{ name: JOB_NAME },
		);
		this.logger.log("Token refresh cron registered (every 15 min)");
	}

	async process(job: Job): Promise<void> {
		if (job.name !== JOB_NAME) return;

		this.logger.debug("Starting proactive token refresh scan");

		const cutoff = new Date(Date.now() + EXPIRY_BUFFER_MS);

		const expiringConnections = await this.prisma.connection.findMany({
			where: {
				status: "ACTIVE",
				tokenExpiresAt: { lt: cutoff },
			},
			select: { id: true },
			orderBy: { tokenExpiresAt: "asc" },
			take: BATCH_SIZE,
		});

		if (expiringConnections.length === 0) {
			this.logger.debug("No tokens expiring soon");
			return;
		}

		this.logger.log(
			`Found ${expiringConnections.length} connections with expiring tokens`,
		);

		let refreshed = 0;
		let failed = 0;

		for (const conn of expiringConnections) {
			try {
				await this.integrationsService.resolveAccessToken(conn.id);
				refreshed++;
			} catch (error) {
				failed++;
				this.logger.warn(
					`Failed to refresh token for connection ${conn.id}: ${
						error instanceof Error ? error.message : "Unknown"
					}`,
				);

				// Error recording (consecutiveErrors increment, lastErrorMessage, lastErrorAt)
				// is already handled by TokenRefresher.doRefresh → deps.markConnectionError.
				// Only check threshold here to mark REFRESH_FAILED.
				const conn_updated = await this.prisma.connection.findUnique({
					where: { id: conn.id },
					select: { consecutiveErrors: true },
				});

				if (
					conn_updated &&
					conn_updated.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS
				) {
					await this.prisma.connection.update({
						where: { id: conn.id },
						data: { status: "REFRESH_FAILED" },
					});
					this.logger.warn(
						`Connection ${conn.id} marked REFRESH_FAILED after ${conn_updated.consecutiveErrors} consecutive errors`,
					);
				}
			}
		}

		this.logger.log(
			`Token refresh complete: ${refreshed} refreshed, ${failed} failed`,
		);

		// Clean up expired OAuth states (abandoned authorization flows)
		const { count: cleanedStates } = await this.prisma.oAuthState.deleteMany({
			where: { expiresAt: { lt: new Date() } },
		});
		if (cleanedStates > 0) {
			this.logger.log(`Cleaned up ${cleanedStates} expired OAuth states`);
		}
	}
}
