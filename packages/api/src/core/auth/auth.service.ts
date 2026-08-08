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
		// Availability rule: boot aborts only on positive evidence of violation.
		// An unreadable count (fresh install before db init, transient outage)
		// must not brick startup — creation stays fail-closed in the auth hook.
		let count: number;
		try {
			count = await this.prismaService.organization.count();
		} catch (err) {
			this.logger.warn(
				`ADR-0011 §6 single-tenant invariant could not be verified at startup (${
					err instanceof Error ? err.message : String(err)
				}). Continuing — the invariant remains enforced on the organization-creation path.`,
			);
			return;
		}
		if (count > 1) {
			const message = `ADR-0011 §6 single-tenant core invariant violation: expected at most 1 organization, found ${count}. Startup aborted.`;
			this.logger.error(message);
			throw new Error(message);
		}
	}

	onModuleInit() {
		const databaseUrl = this.configService.get<string>("DATABASE_URL", "");
		const isPostgres = databaseUrl.startsWith("postgres");

		// The origin this process actually serves on. This used to default to the
		// literal `http://localhost:3001`, which made `pl up --port 8080` — or any
		// bind other than the dev stack's — reject every sign-in with
		// INVALID_ORIGIN. Single-origin means the browser's Origin header is
		// whatever `pl up` is listening on, so derive it rather than assume it.
		const protocol = this.configService.get<string>(
			"PRISMALENS_PROTOCOL",
			"http",
		);
		const host = this.configService.get<string>("PRISMALENS_HOST", "localhost");
		const port = this.configService.get<number>("PRISMALENS_PORT", 3001);
		// A wildcard bind names no origin a browser could send; the reachable name
		// for the machine itself is localhost. NB this DERIVES an origin from the
		// bind — it does not choose the bind. #339 (PR #353) changes the schema
		// default from `0.0.0.0` to `127.0.0.1` and adds a non-loopback warning;
		// the two are complementary, and this branch adds no bind warning of its
		// own. After #339 this branch only fires when an operator sets a wildcard
		// bind deliberately, which is exactly when it is still needed.
		const boundHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
		// A literal IPv6 address must be bracketed before a port is appended, or
		// `http://::1:3001` parses as a host of `::1:3001` with no port at all.
		const authority = boundHost.includes(":") ? `[${boundHost}]` : boundHost;
		const publicUrl =
			this.configService.get<string>("PRISMALENS_PUBLIC_URL") ??
			`${protocol}://${authority}:${port}`;

		const secret = this.configService.get<string>("PRISMALENS_AUTH_SECRET");
		if (!secret) {
			this.logger.error(
				"PRISMALENS_AUTH_SECRET is required. It should be auto-generated — check ~/.prismalens/",
			);
			throw new Error(
				"PRISMALENS_AUTH_SECRET environment variable is required",
			);
		}

		// `Secure` cookies are keyed to the SCHEME, not to NODE_ENV. `pl up` runs
		// with NODE_ENV=production over plain http on loopback, and the old
		// `NODE_ENV === "production"` test therefore set `Secure` on a session
		// cookie the browser then refused to send back: sign-in appeared to work
		// and the very next page load was signed out again. Over https this is
		// unchanged and still on.
		const secureCookies = publicUrl.startsWith("https://");
		// NODE_ENV no longer decides `Secure` — the resolved origin's scheme does.
		// That makes PRISMALENS_PUBLIC_URL (or PRISMALENS_PROTOCOL) load-bearing for
		// cookie security in any deployment that terminates TLS in front of this
		// process: set NODE_ENV=production but leave those unset, and the session
		// cookie silently loses `Secure`. Warn rather than fail closed — a local
		// NODE_ENV=production run over plain HTTP (e.g. `pl up`) is legitimate.
		if (
			!secureCookies &&
			this.configService.get<string>("NODE_ENV") === "production"
		) {
			this.logger.warn(
				"NODE_ENV=production but the resolved origin is not https, so session cookies will be issued without the Secure attribute. If this deployment terminates TLS in front of the API, set PRISMALENS_PUBLIC_URL (or PRISMALENS_PROTOCOL=https).",
			);
		}

		// Build trusted origins list — in the dev stack the browser talks to Vite
		// on another port and only reaches the API through its proxy.
		const frontendUrl = this.configService.get<string>(
			"PRISMALENS_FRONTEND_URL",
			"http://localhost:3000",
		);
		// `localhost` and `127.0.0.1` are distinct ORIGINS but the same machine, so
		// trusting both spellings of a loopback bind adds no reach — and without it
		// `pl up --host 127.0.0.1` locks out anyone who typed `localhost`.
		const loopback = [
			"localhost",
			"127.0.0.1",
			"0.0.0.0",
			"::1",
			"::",
		].includes(host)
			? [`${protocol}://localhost:${port}`, `${protocol}://127.0.0.1:${port}`]
			: [];
		const trustedOrigins = [publicUrl, frontendUrl, ...loopback].filter(
			(url, i, arr) => arr.indexOf(url) === i,
		);

		this._auth = createAuth(prisma, {
			databaseProvider: isPostgres ? "postgresql" : "sqlite",
			baseURL: publicUrl,
			trustedOrigins,
			secret,
			secureCookies,
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
