// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Adds `operator`, `user` and `session` to Express Request, set by AuthGuard.
 * `operator` says why the request counts as the operator; `user` and `session`
 * are present for a Better Auth session, and `user` alone on loopback when the
 * instance's account exists.
 */

import type { Session, User } from "@prismalens/auth";
import type { Operator } from "../core/auth/operator.resolver.js";

declare module "express" {
	interface Request {
		operator?: Operator;
		user?: User;
		session?: Session;
	}
}
