// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Auth Module Exports
 */

export { AuthGuard } from "./auth.guard.js";
export { AuthModule } from "./auth.module.js";
export { AuthService } from "./auth.service.js";
export { CurrentSession, CurrentUser } from "./current-user.decorator.js";
export { type Operator, OperatorResolver } from "./operator.resolver.js";
export { extractUserId } from "./orpc-auth.utils.js";
export { Public } from "./public.decorator.js";
