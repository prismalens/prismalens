// Types

export type {
	AuthManagerDeps,
	GitHubInstallation,
	InstallationTokenResult,
	OAuth2StoreDeps,
	RefreshableConnection,
	RefreshDeps,
	StartAuthorizationParams,
} from "./engine/index.js";
// Engine
export {
	AuthError,
	AuthManager,
	CredentialsInvalidError,
	GitHubAppFlow,
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
