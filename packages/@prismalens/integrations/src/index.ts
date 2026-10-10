// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Types
export type {
	AuthManagerDeps,
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
	checkOAuthScopes,
	getCapabilities,
	getTemplatesForCapability,
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
	urlOnlyRequestFn,
} from "./engine/index.js";
// Providers — deployment
export type { DeploymentProvider } from "./providers/deployment.interface.js";
// Providers — git
export type {
	GitProvider,
	GitProviderContext,
} from "./providers/git.interface.js";
// Providers — adapters & registry (#446, #633)
export {
	adapterSegments,
	createAdapter,
	GitHubAdapter,
	GitHubVcsSegment,
	getAdapter,
	getAdapterSegments,
	getRegisteredTemplateIds,
	getTemplatesForSegment,
	isAdapterSupported,
	PrometheusAdapter,
	PrometheusMetricsSegment,
	RenderAdapter,
	RenderDeploymentSegment,
	templatesForSegment,
} from "./providers/index.js";
// Providers — metrics (#633)
export {
	type AlertRule,
	type InstantSample,
	type MetricsQueries,
	type QueryBudget,
	QueryBudgetExceededError,
	type RangeSeries,
} from "./providers/metrics.interface.js";
// Providers — shared types
export type {
	AuthenticatedRequestFn,
	ProviderAdapter,
	ProviderAdapterFactory,
	SegmentKind,
} from "./providers/types.js";
// Templates
export {
	alertmanager,
	getAllTemplates,
	getTemplate,
	getTemplatesByAuthMode,
	getTemplatesByCategory,
	gitHostToken,
	githubToken,
	isLegacyTemplateId,
	LEGACY_TEMPLATE_IDS,
	prometheus,
	render,
} from "./templates/index.js";
export type {
	AuthMode,
	AuthTemplate,
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
