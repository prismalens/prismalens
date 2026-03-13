// Types
export type {
	AuthManagerDeps,
	GitHubInstallation,
	InstallationTokenResult,
	OAuth2StoreDeps,
	PermissionCheckResult,
	RefreshableConnection,
	RefreshDeps,
	StartAuthorizationParams,
} from "./engine/index.js";
// Engine
export {
	AuthError,
	AuthManager,
	CapabilityNotSupportedError,
	CredentialsInvalidError,
	GitHubAppFlow,
	assertCapability,
	checkGitHubAppPermissions,
	checkOAuthScopes,
	getCapabilities,
	hasCapability,
	interpolate,
	interpolateRecord,
	interpolateWithFunctions,
	OAuth2Flow,
	ProviderError,
	RateLimitError,
	TokenExpiredError,
	TokenRefreshError,
	TokenRefresher,
	TokenVault,
} from "./engine/index.js";
// Providers
export type {
	AuthenticatedRequestFn,
	GitProvider,
	GitProviderContext,
	GitProviderFactory,
} from "./providers/github/index.js";
export {
	createGitProvider,
	GitHubProvider,
	isGitProviderSupported,
	resolveGitProviderName,
} from "./providers/github/index.js";
// Templates
export {
	getAllTemplates,
	getTemplate,
	getTemplatesByAuthMode,
	getTemplatesByCategory,
	githubApp,
	githubToken,
	prometheus,
	render,
	slack,
	slackToken,
// placeholder
} from "./templates/index.js";
export type {
	AuthMode,
	AuthTemplate,
	GitHubAppConfig,
	OAuth2Config,
	OAuthStateData,
	TemplateField,
	TemplateFieldOption,
	TokenResult,
} from "./types.js";
export {
	AuthModeSchema,
	TemplateFieldOptionSchema,
	TemplateFieldSchema,
} from "./types.js";
