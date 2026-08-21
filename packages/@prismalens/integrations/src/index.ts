// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

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
	assertCapability,
	CapabilityNotSupportedError,
	CredentialsInvalidError,
	checkGitHubAppPermissions,
	checkOAuthScopes,
	GitHubAppFlow,
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
// Providers — deployment
export type { DeploymentProvider } from "./providers/deployment.interface.js";
// Providers — git
export type {
	GitProvider,
	GitProviderContext,
} from "./providers/git.interface.js";
// Providers — adapters & registry (#446)
export {
	adapterCapabilities,
	adapterSegments,
	createAdapter,
	GitHubAdapter,
	GitHubVcsSegment,
	getAdapter,
	getAdapterCapabilities,
	getAdapterSegments,
	getTemplatesForCapability,
	getTemplatesForSegment,
	isAdapterSupported,
	RenderAdapter,
	RenderDeploymentSegment,
	templatesForCapability,
	templatesForSegment,
	VercelAdapter,
	VercelDeploymentSegment,
} from "./providers/index.js";
// Providers — shared types
export type {
	AuthenticatedRequestFn,
	ProviderAdapter,
	ProviderAdapterFactory,
	SegmentKind,
} from "./providers/types.js";
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
