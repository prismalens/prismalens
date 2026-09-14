// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * oRPC Auth Utilities
 *
 * Shared helper functions for extracting user info and enforcing roles
 * within oRPC handler contexts. Use these instead of duplicating
 * auth checks in each controller.
 */

import { ORPCError, type ORPCGlobalContext } from "@orpc/nest";

/**
 * Extract the authenticated user's ID from the oRPC context.
 * Throws UNAUTHORIZED if no user is present.
 */
export function extractUserId(context: ORPCGlobalContext): string {
	const userId = context.request.user?.id;
	if (!userId) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Authentication required",
		});
	}
	return userId;
}
