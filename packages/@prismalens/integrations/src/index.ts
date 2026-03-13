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
	assertCapability,
	AuthError,
	AuthManager,
	CapabilityNotSupportedError,
	checkGitHubAppPermissions,
	checkOAuthScopes,
	CredentialsInvalidError,
	getCapabilities,
	GitHubAppFlow,
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
// Providers — shared types
export type { AuthenticatedRequestFn } from "./providers/types.js";
// Providers — git
export type {
	GitProvider,
	GitProviderContext,
	GitProviderFactory,
} from "./providers/git.interface.js";
export {
	createGitProvider,
	GitHubProvider,
	isGitProviderSupported,
	resolveGitProviderName,
} from "./providers/index.js";
// Providers — deployment
export type {
	DeploymentProvider,
	DeploymentProviderFactory,
} from "./providers/deployment.interface.js";
export {
	createDeploymentProvider,
	isDeploymentProviderSupported,
	RenderProvider,
	resolveDeploymentProviderName,
} from "./providers/index.js";
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
