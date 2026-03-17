/**
 * oRPC Auth Utilities
 *
 * Shared helper functions for extracting user info and enforcing roles
 * within oRPC handler contexts. Use these instead of duplicating
 * auth checks in each controller.
 */

import { ORPCError, type ORPCGlobalContext } from '@orpc/nest';
import { ADMIN_ROLES, APP_ROLES, type AppRole } from '@prismalens/auth';

/**
 * Extract the authenticated user's ID from the oRPC context.
 * Throws UNAUTHORIZED if no user is present.
 */
export function extractUserId(context: ORPCGlobalContext): string {
  const userId = context.request.user?.id;
  if (!userId) {
    throw new ORPCError('UNAUTHORIZED', {
      message: 'Authentication required',
    });
  }
  return userId;
}

/**
 * Get the authenticated user's role from the oRPC context.
 * Returns undefined if no user is present or role is not a recognized AppRole.
 */
export function getUserRole(context: ORPCGlobalContext): AppRole | undefined {
  const role = context.request.user?.role ?? undefined;
  if (!role) return undefined;
  return (APP_ROLES as readonly string[]).includes(role)
    ? (role as AppRole)
    : undefined;
}

/**
 * Check if the current user has admin (owner or admin) privileges.
 */
export function isAdmin(context: ORPCGlobalContext): boolean {
  const role = getUserRole(context);
  return (
    role !== undefined && (ADMIN_ROLES as readonly string[]).includes(role)
  );
}

/**
 * Require admin (owner or admin) role. Throws FORBIDDEN if not.
 */
export function requireAdmin(context: ORPCGlobalContext): void {
  if (!isAdmin(context)) {
    throw new ORPCError('FORBIDDEN', {
      message: 'Admin access required',
    });
  }
}

/**
 * Require owner role specifically. Throws FORBIDDEN if not.
 */
export function requireOwner(context: ORPCGlobalContext): void {
  const role = getUserRole(context);
  if (role !== 'owner') {
    throw new ORPCError('FORBIDDEN', {
      message: 'Owner access required',
    });
  }
}
