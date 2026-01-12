/**
 * Auth Client for PrismaLens Frontend
 *
 * This module exports the Better Auth client configured for the PrismaLens frontend.
 * It provides authentication hooks and methods for:
 * - Sign in/out
 * - Session management
 * - Organization management
 */

import {
	authClient,
	signIn,
	signUp,
	signOut,
	useSession,
	getSession,
	organization,
	admin,
} from "@prismalens/auth/client";

// Re-export everything from the auth package
export {
	authClient,
	signIn,
	signUp,
	signOut,
	useSession,
	getSession,
	organization,
	admin,
};

// Export types
export type { AuthClient } from "@prismalens/auth/client";
