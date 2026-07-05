// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * PrismaLens role definitions — single source of truth.
 *
 * owner:  Instance creator (1 per instance). Full access + danger zone.
 * admin:  Promoted by owner. Manage integrations, services, users.
 * member: Default for invited users. Use the app, trigger investigations.
 */
export const APP_ROLES = ["owner", "admin", "member"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const ADMIN_ROLES: readonly AppRole[] = ["owner", "admin"] as const;
