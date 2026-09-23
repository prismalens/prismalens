// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Adds `operator`, `user` and `session` to Express Request, set by AuthGuard.
 * `operator` says which credential made the request the operator.
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
