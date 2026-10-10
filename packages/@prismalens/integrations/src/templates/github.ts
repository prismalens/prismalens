// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PermissionRequirement } from "@prismalens/config/integrations";
import type { AuthTemplate } from "../types.js";

// =============================================================================
// GitHub PAT — user-scoped token permissions. Unlisted since 0.5.1: saved rows
// keep cloning as a git host token for github.com or their GHES host (#673).
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
	gitHost: true,
	connectionCreation: { mode: "form" },
	postIntegrationCreation: { action: "none" },
	display: { authModeLabel: "API Key", listed: false },
};
