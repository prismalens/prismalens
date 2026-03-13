export { interpolate, interpolateWithFunctions, interpolateRecord } from "./interpolate.js";
export { TokenVault } from "./token-vault.js";
export { OAuth2Flow } from "./oauth2-flow.js";
export type { OAuth2StoreDeps, StartAuthorizationParams } from "./oauth2-flow.js";
export { TokenRefresher } from "./token-refresh.js";
export type { RefreshableConnection, RefreshDeps } from "./token-refresh.js";
export { GitHubAppFlow } from "./github-app-flow.js";
export type { InstallationTokenResult, GitHubInstallation } from "./github-app-flow.js";
export { AuthManager } from "./auth-manager.js";
export type { AuthManagerDeps } from "./auth-manager.js";
export {
	AuthError,
	TokenExpiredError,
	TokenRefreshError,
	ProviderError,
	RateLimitError,
	CredentialsInvalidError,
} from "./errors.js";
export {
	CapabilityNotSupportedError,
	getCapabilities,
	hasCapability,
	assertCapability,
} from "./capability-check.js";
export {
	checkGitHubAppPermissions,
	checkOAuthScopes,
} from "./permission-check.js";
export type { PermissionCheckResult } from "./permission-check.js";
