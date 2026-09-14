// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Adds `user` and `session` to Express Request, set by AuthGuard from Better Auth's getSession(). */

import type { Session, User } from "@prismalens/auth";

declare module "express" {
	interface Request {
		user?: User;
		session?: Session;
	}
}
