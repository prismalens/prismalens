// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export type { AuthManagerDeps } from "./auth-manager.js";
export { AuthManager } from "./auth-manager.js";
export {
	assertCapability,
	CapabilityNotSupportedError,
	getCapabilities,
	getTemplatesForCapability,
	hasCapability,
} from "./capability-check.js";
export {
	AuthError,
	CredentialsInvalidError,
	ProviderError,
	RateLimitError,
	TokenExpiredError,
	TokenRefreshError,
} from "./errors.js";
export {
	interpolate,
	interpolateRecord,
	interpolateWithFunctions,
} from "./interpolate.js";
export type {
	OAuth2StoreDeps,
	StartAuthorizationParams,
} from "./oauth2-flow.js";
export { OAuth2Flow } from "./oauth2-flow.js";
export type { PermissionCheckResult } from "./permission-check.js";
export { checkOAuthScopes } from "./permission-check.js";
export {
	httpStatusDiagnostic,
	providerHttpError,
	providerJsonParseError,
} from "./provider-http-error.js";
export type { RefreshableConnection, RefreshDeps } from "./token-refresh.js";
export { TokenRefresher } from "./token-refresh.js";
export { TokenVault } from "./token-vault.js";
export { urlOnlyRequestFn } from "./url-only-request.js";
