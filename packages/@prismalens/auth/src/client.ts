/**
 * Better Auth Client Configuration
 *
 * This is the client-side authentication configuration for PrismaLens.
 * Used by the frontend to:
 * - Sign in/out users
 * - Access session state
 * - Manage organization invitations
 */

import { createAuthClient } from "better-auth/react";
import { organizationClient, adminClient } from "better-auth/client/plugins";

/**
 * Build an absolute base URL for the Better Auth client.
 * Better Auth requires an absolute URL with protocol (http:// or https://).
 * In the browser, uses window.location.origin; in SSR, uses env vars.
 */
function getDefaultBaseURL(): string {
	// Use globalThis to avoid needing DOM lib types in the shared package
	const win = globalThis as unknown as { location?: { origin: string } };
	if (win.location?.origin) {
		return `${win.location.origin}/api/auth`;
	}
	const protocol = process.env.PRISMALENS_PROTOCOL || "http";
	const host = process.env.PRISMALENS_HOST || "localhost";
	const port = process.env.PRISMALENS_PORT || "3001";
	return `${protocol}://${host}:${port}/api/auth`;
}

/**
 * Create the Better Auth client instance.
 *
 * @param baseURL - Absolute URL of the auth API (defaults to auto-detected origin + /api/auth)
 */
export function createPrismaLensAuthClient(baseURL: string = getDefaultBaseURL()) {
	return createAuthClient({
		baseURL,
		plugins: [
			// Organization client for invitation management
			organizationClient(),
			// Admin client for user management
			adminClient(),
		],
	});
}

/**
 * Type of the auth client
 */
export type AuthClient = ReturnType<typeof createPrismaLensAuthClient>;

/**
 * Pre-configured auth client for use in the frontend.
 * Uses auto-detected absolute URL (browser origin or SSR env vars).
 */
export const authClient = createPrismaLensAuthClient();

/**
 * Destructured exports for convenience
 */
export const {
	signIn,
	signUp,
	signOut,
	useSession,
	getSession,
	organization,
	admin,
} = authClient;
