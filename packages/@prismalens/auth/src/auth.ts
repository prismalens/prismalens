// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Better Auth Server Configuration
 *
 * This is the main authentication configuration for PrismaLens.
 * It handles:
 * - Email/password authentication
 * - Session management (cookie-based)
 */

import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";

/** The one query this plugin needs. */
interface UserLookupClient {
	user: { findFirst(args: { select: { id: true } }): Promise<unknown> };
}

/**
 * Refuses `POST /sign-up/email` once any account exists: an instance has one
 * operator (ADR 0001 §13). Setup (`UsersService.setupOwner`) signs up the first
 * account, before any row exists, so it is never blocked by this. Better Auth 1.7.2's `emailAndPassword.disableSignUp` is a
 * plain boolean checked once at request time from the options object (see
 * `dist/api/routes/sign-up.mjs`), not a function of live DB state, so a
 * request-time DB check needs this hook instead (same `matcher`/`handler`
 * shape the library's own `username` plugin uses for the same endpoint).
 */
export function closeSignUpAfterOwner(prisma: unknown): BetterAuthPlugin {
	const client = prisma as UserLookupClient;
	return {
		id: "close-sign-up-after-owner",
		hooks: {
			before: [
				{
					matcher: (ctx) => ctx.path === "/sign-up/email",
					handler: createAuthMiddleware(async () => {
						const existing = await client.user.findFirst({
							select: { id: true },
						});
						if (existing) {
							throw new APIError("FORBIDDEN", {
								message:
									"Sign-up is closed: this instance already has its account.",
								code: "SIGN_UP_CLOSED",
							});
						}
					}),
				},
			],
		},
	};
}

export function createAuth(prisma: unknown, options: AuthOptions) {
	return betterAuth({
		database: prismaAdapter(prisma as Parameters<typeof prismaAdapter>[0], {
			provider: "sqlite",
		}),

		// Base URL for auth endpoints
		baseURL: options.baseURL,

		// Trust the frontend origin (may differ from API baseURL in dev)
		trustedOrigins: options.trustedOrigins,

		// Secret for signing tokens/cookies
		secret: options.secret,

		// Email and password authentication
		emailAndPassword: {
			enabled: true,
			// Don't require email verification for self-hosted (no SMTP needed)
			requireEmailVerification: false,
			// Password requirements
			minPasswordLength: 8,
		},

		// Session configuration
		session: {
			expiresIn: 60 * 60 * 24 * 7, // 7 days in seconds
			updateAge: 60 * 60 * 24, // Update session every day
			cookieCache: {
				enabled: true,
				maxAge: 60 * 5, // 5 minutes cache
			},
		},

		// Advanced options
		advanced: {
			useSecureCookies: options.secureCookies,
			cookiePrefix: "prismalens",
		},

		plugins: [closeSignUpAfterOwner(prisma)],
	});
}

/**
 * Options for creating the auth instance
 */
export interface AuthOptions {
	/** Base URL for the API (e.g., "http://localhost:3001") */
	baseURL: string;

	/** Trusted origins that can make auth requests (e.g., frontend URL) */
	trustedOrigins?: string[];

	/** Secret for signing tokens. Generate with: openssl rand -base64 32 */
	secret: string;

	/** Use secure cookies (true for HTTPS, false for local development) */
	secureCookies: boolean;
}

/**
 * Type of the auth instance
 */
export type Auth = ReturnType<typeof createAuth>;
