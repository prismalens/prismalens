export type { AuthManagerDeps } from "./auth-manager.js";
export { AuthManager } from "./auth-manager.js";
export {
	assertCapability,
	CapabilityNotSupportedError,
	getCapabilities,
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
export type {
	GitHubInstallation,
	InstallationTokenResult,
} from "./github-app-flow.js";
export { GitHubAppFlow } from "./github-app-flow.js";
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
export {
	checkGitHubAppPermissions,
	checkOAuthScopes,
} from "./permission-check.js";
export type { RefreshableConnection, RefreshDeps } from "./token-refresh.js";
export { TokenRefresher } from "./token-refresh.js";
export { TokenVault } from "./token-vault.js";
