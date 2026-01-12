/**
 * Better Auth Server Configuration
 *
 * This is the main authentication configuration for PrismaLens.
 * It handles:
 * - Email/password authentication
 * - Session management (cookie-based)
 * - User invitations (via organization plugin)
 * - Role-based access control
 */

import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { admin } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";

/**
 * Create the Better Auth instance.
 *
 * Note: This function must be called with the Prisma client instance
 * because we can't directly import it here (would cause circular dependency).
 * The API package will call this with its Prisma instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAuth(prisma: any, options: AuthOptions) {
	return betterAuth({
		database: prismaAdapter(prisma, {
			provider: options.databaseProvider,
		}),

		// Base URL for auth endpoints
		baseURL: options.baseURL,

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

		// Plugins
		plugins: [
			// Admin plugin for user management
			admin({
				defaultRole: "member",
			}),

			// Organization plugin for team management and invitations
			organization({
				// For Community Edition, we use a single organization
				allowUserToCreateOrganization: true,

				// Custom invitation email handler
				// If SMTP is configured, this sends the email
				// Otherwise, the invite URL is returned in the API response
				async sendInvitationEmail(data) {
					if (options.sendInvitationEmail) {
						const inviteLink = `${options.baseURL}/auth/accept-invitation/${data.id}`;
						await options.sendInvitationEmail({
							email: data.email,
							invitedByEmail: data.inviter.user.email,
							invitedByName: data.inviter.user.name,
							organizationName: data.organization.name,
							organizationSlug: data.organization.slug,
							invitationId: data.id,
							url: inviteLink,
						});
					}
					// If no email handler provided, the invitation URL will be
					// returned in the API response for manual sharing
				},
			}),
		],
	});
}

/**
 * Options for creating the auth instance
 */
export interface AuthOptions {
	/** Database provider: "postgresql" or "sqlite" */
	databaseProvider: "postgresql" | "sqlite";

	/** Base URL for the API (e.g., "http://localhost:3001") */
	baseURL: string;

	/** Secret for signing tokens. Generate with: openssl rand -base64 32 */
	secret: string;

	/** Use secure cookies (true for HTTPS, false for local development) */
	secureCookies: boolean;

	/**
	 * Optional: Custom email sending function for invitations
	 * If not provided, invite URLs are returned in API responses
	 */
	sendInvitationEmail?: (params: {
		email: string;
		invitedByEmail: string;
		invitedByName: string | null;
		organizationName: string;
		organizationSlug: string;
		invitationId: string;
		url: string;
	}) => Promise<void>;
}

/**
 * Type of the auth instance
 */
export type Auth = ReturnType<typeof createAuth>;
