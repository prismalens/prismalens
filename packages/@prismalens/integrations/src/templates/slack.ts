import type { PermissionRequirement } from "@prismalens/config/integrations";
import type { AuthTemplate } from "../types.js";

// =============================================================================
// Slack OAuth — bot scopes derived from requiredPermissions
// =============================================================================

const slackPermissions: PermissionRequirement[] = [
	{
		key: "channels:read",
		reason: "List channels for notifications",
		capabilities: ["messaging:read"],
	},
	{
		key: "chat:write",
		reason: "Send messages to channels",
		capabilities: ["messaging:post"],
	},
	{
		key: "users:read",
		reason: "Look up user information",
		capabilities: ["messaging:read"],
	},
	{
		key: "groups:read",
		reason: "List private channels for alerts",
		capabilities: ["messaging:read"],
	},
];

export const slack: AuthTemplate = {
	id: "slack",
	name: "Slack",
	version: "1.0.0",
	category: "communication",
	authMode: "oauth2",
	icon: "https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png",
	docsUrl: "https://api.slack.com/messaging/webhooks",
	setupDocsUrl: "https://docs.prismalens.io/integrations/slack/",
	requiredPermissions: slackPermissions,
	oauth2: {
		authorizationUrl: "https://slack.com/oauth/v2/authorize",
		tokenUrl: "https://slack.com/api/oauth.v2.access",
		// DERIVED from requiredPermissions — always in sync
		scopes: slackPermissions.map((p) => p.key),
		tokenAuthMethod: "body",
		tokenResponseMetadata: ["incoming_webhook.url", "bot_user_id", "team.id"],
		clientCredentialSource: "both",
	},
	authenticate: {
		headers: { Authorization: "Bearer {{accessToken}}" },
	},
	proxy: {
		baseUrl: "https://slack.com/api",
	},
	verify: { method: "POST", path: "/auth.test" },
	connectionCreation: { mode: "oauth_redirect" },
	postIntegrationCreation: { action: "oauth_redirect" },
	display: { authModeLabel: "OAuth" },
};

// =============================================================================
// Slack Bot Token — direct token, best-effort permission tracking
// =============================================================================

const slackTokenPermissions: PermissionRequirement[] = [
	{
		key: "chat:write",
		reason: "Send messages to channels",
		capabilities: ["messaging:post"],
	},
];

export const slackToken: AuthTemplate = {
	id: "slack-token",
	name: "Slack (Bot Token)",
	version: "1.0.0",
	category: "communication",
	authMode: "api_key",
	icon: "https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png",
	docsUrl: "https://api.slack.com/messaging/webhooks",
	setupDocsUrl: "https://docs.prismalens.io/integrations/slack-bot-token/",
	requiredPermissions: slackTokenPermissions,
	connectionCredentialFields: [
		{
			name: "apiKey",
			label: "Bot Token",
			type: "password",
			required: true,
			placeholder: "xoxb-...",
			description: "Slack bot token with chat:write scope",
			sensitive: true,
		},
	],
	connectionFields: [
		{
			name: "defaultChannel",
			label: "Default Channel",
			type: "string",
			required: false,
			placeholder: "#incidents",
			description: "Default Slack channel for notifications",
		},
	],
	authenticate: {
		headers: { Authorization: "Bearer {{apiKey}}" },
	},
	proxy: {
		baseUrl: "https://slack.com/api",
	},
	verify: { method: "POST", path: "/auth.test" },
	connectionCreation: { mode: "form" },
	postIntegrationCreation: { action: "none" },
	display: { authModeLabel: "API Key" },
};
