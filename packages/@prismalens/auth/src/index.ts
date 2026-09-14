// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * @prismalens/auth
 *
 * Authentication configuration and utilities for PrismaLens using Better Auth.
 * This package exports:
 * - Server-side auth configuration (for API)
 * - Auth types and utilities
 */

export type { Session, User } from "better-auth/types";
export { type Auth, type AuthOptions, createAuth } from "./auth.js";
