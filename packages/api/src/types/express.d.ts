// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Adds `operator` to Express Request, set by AuthGuard: the paired device making the request. */

import type { Operator } from "../core/auth/operator.resolver.js";

declare module "express" {
	interface Request {
		operator?: Operator;
	}
}
