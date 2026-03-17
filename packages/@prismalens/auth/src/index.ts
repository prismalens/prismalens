/**
 * @prismalens/auth
 *
 * Authentication configuration and utilities for PrismaLens using Better Auth.
 * This package exports:
 * - Server-side auth configuration (for API)
 * - Auth types and utilities
 */

export { createAuth, type Auth, type AuthOptions } from "./auth.js";
export type { Session, User } from "better-auth/types";
export type { UserWithRole } from "better-auth/plugins/admin";
export { APP_ROLES, ADMIN_ROLES, type AppRole } from "./roles.js";
