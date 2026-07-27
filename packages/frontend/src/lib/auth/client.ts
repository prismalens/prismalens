// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

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
	admin,
	authClient,
	getSession,
	organization,
	signIn,
	signOut,
	signUp,
	useSession,
} from "@prismalens/auth/client";

// Export types
export type { AuthClient } from "@prismalens/auth/client";
// Re-export everything from the auth package
export {
	admin,
	authClient,
	getSession,
	organization,
	signIn,
	signOut,
	signUp,
	useSession,
};
