// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PermissionRequirement } from "@prismalens/config/integrations";
import type { AuthTemplate } from "../types.js";

// =============================================================================
// GitHub App — installation token permissions
// Note: vcs:list_orgs intentionally absent — installation tokens cannot list user orgs
// =============================================================================

const githubAppPermissions: PermissionRequirement[] = [
	{
		key: "contents",
		level: "read",
		reason: "Read repository files for code analysis",
		capabilities: ["vcs:list_repos", "vcs:read_file"],
	},
	{
		key: "metadata",
		level: "read",
		reason: "Access repository metadata",
		capabilities: ["vcs:list_repos"],
	},
	{
		key: "issues",
		level: "read",
		reason: "Read issues for investigation context",
		capabilities: [],
	},
	{
		key: "pull_requests",
		level: "read",
		reason: "Read pull requests for investigation",
		capabilities: [],
	},
	{
		key: "statuses",
		level: "read",
		reason: "Read commit/CI statuses for investigations",
		capabilities: ["vcs:read_commit_status"],
	},
];

export const githubApp: AuthTemplate = {
	id: "github-app",
	name: "GitHub (App)",
	version: "1.0.0",
	category: "vcs",
	authMode: "github_app",
	icon: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
	docsUrl: "https://docs.github.com/en/apps/creating-github-apps",
	setupDocsUrl: "https://docs.prismalens.io/integrations/github-app/",
	integrationCredentialFields: [
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
			description: "PEM-encoded private key generated for your GitHub App",
			sensitive: true,
		},
		{
			name: "baseUrl",
			label: "API Base URL",
			type: "string",
			required: false,
			default: "https://api.github.com",
			placeholder: "https://api.github.com",
			description:
				"For GitHub Enterprise Server, use https://your-domain.com/api/v3",
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
	requiredPermissions: githubAppPermissions,
	githubApp: {
		// DERIVED from requiredPermissions — always in sync
		defaultPermissions: Object.fromEntries(
			githubAppPermissions.map((p) => [p.key, p.level ?? "read"]),
		),
	},
	authenticate: {
		headers: { Authorization: "Bearer {{installationToken}}" },
	},
	proxy: {
		baseUrl: "{{baseUrl}}",
		headers: {
			Accept: "application/vnd.github.v3+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	},
	verify: { method: "GET", path: "/installation/repositories?per_page=1" },
	connectionCreation: { mode: "form" },
	postIntegrationCreation: {
		action: "navigate",
		navigateTo: "/settings/integrations/configure",
	},
	display: { authModeLabel: "GitHub App" },
};

// =============================================================================
// GitHub PAT — user-scoped token permissions
// =============================================================================

const githubTokenPermissions: PermissionRequirement[] = [
	{
		key: "read:org",
		reason: "List organizations the user belongs to",
		capabilities: ["vcs:list_orgs"],
	},
	{
		key: "repo",
		reason: "Access repositories for code analysis",
		capabilities: ["vcs:list_repos", "vcs:read_file"],
	},
	{
		key: "repo:status",
		reason: "Read commit/CI statuses",
		capabilities: ["vcs:read_commit_status"],
	},
];

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
	connectionCredentialFields: [
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
		{
			name: "baseUrl",
			label: "API Base URL",
			type: "string",
			required: false,
			default: "https://api.github.com",
			placeholder: "https://api.github.com",
			description:
				"For GitHub Enterprise Server, use https://your-domain.com/api/v3",
		},
	],
	requiredPermissions: githubTokenPermissions,
	authenticate: {
		headers: { Authorization: "Bearer {{apiKey}}" },
	},
	proxy: {
		baseUrl: "{{baseUrl}}",
		headers: {
			Accept: "application/vnd.github.v3+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	},
	verify: { method: "GET", path: "/user" },
	connectionCreation: { mode: "form" },
	postIntegrationCreation: { action: "none" },
	display: { authModeLabel: "API Key" },
};
