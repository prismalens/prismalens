// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Express Request augmentation
 *
 * Adds typed `user` and `session` properties to Express Request,
 * populated by AuthGuard from Better Auth's getSession().
 *
 * Uses `UserWithRole` from Better Auth's admin plugin which includes
 * the `role` field (string | undefined), `banned`, `banReason`, `banExpires`.
 */

import type { Session, UserWithRole } from "@prismalens/auth";

declare module "express" {
	interface Request {
		user?: UserWithRole;
		session?: Session;
	}
}
