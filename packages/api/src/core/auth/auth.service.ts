// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Auth Service
 *
 * Initializes and exposes the Better Auth instance for PrismaLens.
 * This service creates the auth instance with the Prisma client and
 * provides access to auth APIs throughout the application.
 */

import {
	Injectable,
	Logger,
	OnApplicationBootstrap,
	OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type Auth, createAuth } from "@prismalens/auth";
import { prisma } from "@prismalens/database";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class AuthService implements OnModuleInit, OnApplicationBootstrap {
	private readonly logger = new Logger(AuthService.name);
	private _auth: Auth | null = null;

	constructor(
		private readonly configService: ConfigService,
		private readonly prismaService: PrismaService,
	) {}

	async onApplicationBootstrap(): Promise<void> {
		const count = await this.prismaService.organization.count();
		if (count > 1) {
			const message = `ADR-0011 §6 single-tenant core invariant violation: expected at most 1 organization, found ${count}. Startup aborted.`;
			this.logger.error(message);
			throw new Error(message);
		}
	}

	onModuleInit() {
		const databaseUrl = this.configService.get<string>("DATABASE_URL", "");
		const isPostgres = databaseUrl.startsWith("postgres");

		const publicUrl = this.configService.get<string>(
			"PRISMALENS_PUBLIC_URL",
			"http://localhost:3001",
		);

		const secret = this.configService.get<string>("PRISMALENS_AUTH_SECRET");
		if (!secret) {
			this.logger.error(
				"PRISMALENS_AUTH_SECRET is required. It should be auto-generated — check ~/.prismalens/",
			);
			throw new Error(
				"PRISMALENS_AUTH_SECRET environment variable is required",
			);
		}

		const isProduction =
			this.configService.get<string>("NODE_ENV") === "production";

		// Build trusted origins list — frontend may be on a different port
		const frontendUrl = this.configService.get<string>(
			"PRISMALENS_FRONTEND_URL",
			"http://localhost:3000",
		);
		const trustedOrigins = [publicUrl, frontendUrl].filter(
			(url, i, arr) => arr.indexOf(url) === i,
		);

		this._auth = createAuth(prisma, {
			databaseProvider: isPostgres ? "postgresql" : "sqlite",
			baseURL: publicUrl,
			trustedOrigins,
			secret,
			secureCookies: isProduction,
			// Optional: SMTP email sending for invitations
			sendInvitationEmail: this.createEmailSender(),
		});

		this.logger.log("Better Auth initialized");
	}

	/**
	 * Get the Better Auth instance
	 */
	get auth(): Auth {
		if (!this._auth) {
			throw new Error("Auth not initialized");
		}
		return this._auth;
	}

	/**
	 * Create email sender function if SMTP is configured
	 */
	private createEmailSender() {
		const smtpHost = this.configService.get<string>("PRISMALENS_SMTP_HOST");

		if (!smtpHost) {
			this.logger.log(
				"SMTP not configured - invitation links will be returned in API responses",
			);
			return undefined;
		}

		// Return async email sender function
		// This will be implemented when we add nodemailer
		return async (params: {
			email: string;
			invitedByEmail: string;
			invitedByName: string | null;
			organizationName: string;
			organizationSlug: string;
			invitationId: string;
			url: string;
		}) => {
			this.logger.log(
				`Invitation created for ${params.email} (URL returned in API response)`,
			);
			// TODO: Implement nodemailer integration
		};
	}
}
