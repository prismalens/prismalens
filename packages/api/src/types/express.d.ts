// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Adds `operator` to Express Request, set by AuthGuard: why the request counts as the operator. */

import type { Operator } from "../core/auth/operator.resolver.js";

declare module "express" {
	interface Request {
		operator?: Operator;
	}
}
