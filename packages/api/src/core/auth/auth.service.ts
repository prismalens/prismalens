/**
 * Auth Service
 *
 * Initializes and exposes the Better Auth instance for PrismaLens.
 * This service creates the auth instance with the Prisma client and
 * provides access to auth APIs throughout the application.
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createAuth, type Auth } from "@prismalens/auth";
import { prisma } from "@prismalens/database";

@Injectable()
export class AuthService implements OnModuleInit {
	private readonly logger = new Logger(AuthService.name);
	private _auth: Auth | null = null;

	constructor(private readonly configService: ConfigService) {}

	onModuleInit() {
		const databaseUrl = this.configService.get<string>("DATABASE_URL", "");
		const isPostgres = databaseUrl.startsWith("postgres");

		const publicUrl = this.configService.get<string>(
			"PRISMALENS_PUBLIC_URL",
			"http://localhost:3001",
		);

		const secret = this.configService.get<string>("BETTER_AUTH_SECRET");
		if (!secret) {
			this.logger.error(
				"BETTER_AUTH_SECRET is required. Generate with: openssl rand -base64 32",
			);
			throw new Error("BETTER_AUTH_SECRET environment variable is required");
		}

		const isProduction = this.configService.get<string>("NODE_ENV") === "production";

		this._auth = createAuth(prisma, {
			databaseProvider: isPostgres ? "postgresql" : "sqlite",
			baseURL: publicUrl,
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
			this.logger.log(`Sending invitation email to ${params.email}`);
			// TODO: Implement nodemailer integration
			// For now, log the invitation URL
			this.logger.log(`Invitation URL: ${params.url}`);
		};
	}
}
