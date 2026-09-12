// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Auth Client for PrismaLens Frontend
 *
 * This module exports the Better Auth client configured for the PrismaLens frontend.
 * It provides authentication hooks and methods for:
 * - Sign in/out
 * - Session management
 */

import {
	authClient,
	getSession,
	signIn,
	signOut,
	signUp,
	useSession,
} from "@prismalens/auth/client";

// Export types
export type { AuthClient } from "@prismalens/auth/client";
// Re-export everything from the auth package
export { authClient, getSession, signIn, signOut, signUp, useSession };
