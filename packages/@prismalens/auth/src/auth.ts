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

import {
	type BetterAuthPlugin,
	betterAuth,
	getCurrentAdapter,
} from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";

/**
 * One account per instance (ADR 0001 §13), on every path that creates a user: setup,
 * seed and `/sign-up/email`. The count runs in the user-create database hook, inside
 * the sign-up transaction, so two concurrent sign-ups cannot both see zero users.
 */
export function oneAccountOnly(): BetterAuthPlugin {
	return {
		id: "one-account-only",
		init: (ctx) => ({
			options: {
				databaseHooks: {
					user: {
						create: {
							before: async () => {
								const adapter = await getCurrentAdapter(ctx.adapter);
								if ((await adapter.count({ model: "user" })) > 0) {
									throw new APIError("FORBIDDEN", {
										message:
											"Sign-up is closed: this instance already has its account.",
										code: "SIGN_UP_CLOSED",
									});
								}
							},
						},
					},
				},
			},
		}),
	};
}

export function createAuth(prisma: unknown, options: AuthOptions) {
	return betterAuth({
		database: prismaAdapter(prisma as Parameters<typeof prismaAdapter>[0], {
			provider: "sqlite",
			// Sign-up's runWithTransaction is a no-op without this, and oneAccountOnly needs it.
			transaction: true,
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

		plugins: [oneAccountOnly()],
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
