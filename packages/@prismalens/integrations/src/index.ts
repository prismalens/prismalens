// Types
export type {
	AuthMode,
	AuthTemplate,
	OAuth2Config,
	TemplateField,
	TemplateFieldOption,
	OAuthStateData,
	TokenResult,
	IntegrationEvent,
	IntegrationEventType,
} from "./types.js";
export { AuthModeSchema, TemplateFieldSchema, TemplateFieldOptionSchema } from "./types.js";

// Engine
export {
	interpolate,
	interpolateWithFunctions,
	interpolateRecord,
	TokenVault,
	OAuth2Flow,
	TokenRefresher,
} from "./engine/index.js";
export type {
	OAuth2StoreDeps,
	StartAuthorizationParams,
	RefreshableConnection,
	RefreshDeps,
} from "./engine/index.js";

// Templates
export {
	getTemplate,
	getAllTemplates,
	getTemplatesByCategory,
	getTemplatesByAuthMode,
	githubOAuth2,
	githubToken,
	slack,
	slackToken,
	prometheus,
	render,
} from "./templates/index.js";
