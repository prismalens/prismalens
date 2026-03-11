import type { AuthTemplate } from "../types.js";

export const slack: AuthTemplate = {
	id: "slack",
	name: "Slack",
	version: "1.0.0",
	category: "communication",
	authMode: "oauth2",
	icon: "https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png",
	docsUrl: "https://api.slack.com/messaging/webhooks",
	setupDocsUrl: "https://docs.prismalens.io/integrations/slack/",
	oauth2: {
		authorizationUrl: "https://slack.com/oauth/v2/authorize",
		tokenUrl: "https://slack.com/api/oauth.v2.access",
		scopes: ["channels:read", "chat:write", "users:read", "groups:read"],
		tokenAuthMethod: "body",
		tokenResponseMetadata: [
			"incoming_webhook.url",
			"bot_user_id",
			"team.id",
		],
		clientCredentialSource: "both",
	},
	authenticate: {
		headers: { Authorization: "Bearer {{accessToken}}" },
	},
	proxy: {
		baseUrl: "https://slack.com/api",
	},
	verify: { method: "POST", path: "/auth.test" },
};

export const slackToken: AuthTemplate = {
	id: "slack-token",
	name: "Slack (Bot Token)",
	version: "1.0.0",
	category: "communication",
	authMode: "api_key",
	icon: "https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png",
	docsUrl: "https://api.slack.com/messaging/webhooks",
	setupDocsUrl: "https://docs.prismalens.io/integrations/slack-bot-token/",
	credentialFields: [
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
};
