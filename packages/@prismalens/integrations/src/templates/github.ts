import type { AuthTemplate } from "../types.js";

export const githubApp: AuthTemplate = {
	id: "github-app",
	name: "GitHub (App)",
	version: "1.0.0",
	category: "vcs",
	authMode: "github_app",
	icon: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
	docsUrl: "https://docs.github.com/en/apps/creating-github-apps",
	setupDocsUrl: "https://docs.prismalens.io/integrations/github-app/",
	credentialFields: [
		{
			name: "appId",
			label: "App ID",
			type: "string",
			required: true,
			placeholder: "123456",
			description: "Your GitHub App's ID (found in the App settings page)",
		},
		{
			name: "privateKey",
			label: "Private Key",
			type: "textarea",
			required: true,
			description:
				"PEM-encoded private key generated for your GitHub App",
			sensitive: true,
		},
		{
			name: "webhookSecret",
			label: "Webhook Secret",
			type: "password",
			required: false,
			placeholder: "optional",
			description: "Webhook secret for verifying GitHub webhook payloads",
			sensitive: true,
		},
	],
	connectionFields: [
		{
			name: "installationId",
			label: "Installation ID",
			type: "string",
			required: true,
			placeholder: "12345678",
			description:
				"The installation ID for the organization/account where the App is installed",
		},
		{
			name: "organization",
			label: "Organization",
			type: "string",
			required: false,
			placeholder: "my-org",
			description: "GitHub organization name (auto-detected from installation)",
		},
	],
	githubApp: {
		defaultPermissions: {
			contents: "read",
			metadata: "read",
			issues: "read",
			pull_requests: "read",
		},
	},
	authenticate: {
		headers: { Authorization: "Bearer {{installationToken}}" },
	},
	proxy: {
		baseUrl: "https://api.github.com",
		headers: {
			Accept: "application/vnd.github.v3+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	},
	verify: { method: "GET", path: "/installation/repositories?per_page=1" },
};

export const githubToken: AuthTemplate = {
	id: "github-token",
	name: "GitHub (PAT)",
	version: "1.0.0",
	category: "vcs",
	authMode: "api_key",
	icon: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
	docsUrl: "https://docs.github.com/en/rest",
	setupDocsUrl: "https://docs.prismalens.io/integrations/github-pat/",
	connectionFields: [
		{
			name: "organization",
			label: "Organization",
			type: "string",
			required: false,
			placeholder: "my-org",
			description: "GitHub organization name",
		},
	],
	credentialFields: [
		{
			name: "apiKey",
			label: "Personal Access Token",
			type: "password",
			required: true,
			placeholder: "github_pat_...",
			description:
				"Fine-grained PAT recommended — grants per-repo access with minimal scope",
			sensitive: true,
		},
	],
	authenticate: {
		headers: { Authorization: "Bearer {{apiKey}}" },
	},
	proxy: {
		baseUrl: "https://api.github.com",
		headers: {
			Accept: "application/vnd.github.v3+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	},
	verify: { method: "GET", path: "/user" },
};
