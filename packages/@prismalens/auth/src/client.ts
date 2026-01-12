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
 * Create the Better Auth client instance.
 *
 * @param baseURL - The base URL of the API (e.g., "/api/auth" or "http://localhost:3001/api/auth")
 */
export function createPrismaLensAuthClient(baseURL: string = "/api/auth") {
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
 * Pre-configured auth client for use in the frontend
 * Uses the default "/api/auth" base URL which works with Vite proxy
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
