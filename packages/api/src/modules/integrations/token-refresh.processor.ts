// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Proactive token refresh.
 *
 * Refreshes tokens expiring within 10 minutes. Generic — handles all auth modes (OAuth2,
 * GitHub App, etc.).
 *
 * This used to be a BullMQ repeatable job, which meant a broker had to be running before
 * OAuth connections could stay alive. It is a fixed-interval sweep over a table in the
 * application's own database; it never needed one. Scheduling it in-process is not a
 * downgrade — it removes an external dependency from a path that has no distributed
 * requirement. Overlap is prevented by a re-entrancy guard rather than a queue lock, and
 * a missed cycle is harmless: the next one picks up whatever is still expiring.
 */
import {
	Injectable,
	Logger,
	type OnModuleDestroy,
	type OnModuleInit,
} from "@nestjs/common";
// Constructor-injected — Nest's reflection-based DI needs the runtime class
// reference from a value import to populate emitDecoratorMetadata. `import
// type` here breaks boot with UnknownDependenciesException.
// biome-ignore lint/style/useImportType: see comment above
import { PrismaService } from "../../core/prisma/prisma.service.js";
// biome-ignore lint/style/useImportType: same as PrismaService above
import { IntegrationsService } from "./integrations.service.js";

/** How often the refresh sweep runs */
export const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

/** Refresh tokens expiring within this window */
const EXPIRY_BUFFER_MS = 10 * 60 * 1000;

/** Max consecutive failures before marking connection broken */
const MAX_CONSECUTIVE_ERRORS = 3;

/** Max connections to refresh per cycle (prevents unbounded queries) */
const BATCH_SIZE = 100;

@Injectable()
export class TokenRefreshProcessor implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(TokenRefreshProcessor.name);
	private timer: NodeJS.Timeout | null = null;
	private running = false;

	constructor(
		private readonly prisma: PrismaService,
		private readonly integrationsService: IntegrationsService,
	) {}

	onModuleInit() {
		this.timer = setInterval(() => {
			void this.runSweep();
		}, REFRESH_INTERVAL_MS);
		// A background sweep must never be the reason the process stays alive.
		this.timer.unref?.();
		this.logger.log("Token refresh sweep registered (every 15 min)");
	}

	onModuleDestroy() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	/**
	 * One refresh cycle. Re-entrancy guarded: a sweep that outlives its interval must not
	 * have a second copy of itself racing it over the same connections.
	 */
	async runSweep(): Promise<void> {
		if (this.running) {
			this.logger.debug("Token refresh sweep already in progress — skipping");
			return;
		}
		this.running = true;
		try {
			await this.process();
		} catch (error) {
			this.logger.error(
				`Token refresh sweep failed: ${
					error instanceof Error ? error.message : "Unknown"
				}`,
			);
		} finally {
			this.running = false;
		}
	}

	async process(): Promise<void> {
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
