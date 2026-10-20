// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PermissionRequirement } from "@prismalens/config/integrations";
import type { AuthTemplate } from "../types.js";

// GitLab token scopes: https://docs.gitlab.com/user/profile/personal_access_tokens/#personal-access-token-scopes
const gitlabTokenPermissions: PermissionRequirement[] = [
	{
		key: "read_api",
		reason: "List groups, projects and commits, and read the token's user",
		capabilities: ["vcs:list_orgs", "vcs:list_repos", "vcs:read_commits"],
	},
	{
		key: "read_repository",
		reason: "Clone the repositories bound to a service and read their files",
		capabilities: ["vcs:read_file"],
	},
];

export const gitlabToken: AuthTemplate = {
	id: "gitlab-token",
	name: "GitLab (token)",
	version: "1.0.0",
	category: "vcs",
	authMode: "api_key",
	docsUrl: "https://docs.gitlab.com/api/rest/",
	connectionFields: [],
	connectionCredentialFields: [
		{
			name: "apiKey",
			label: "Access token",
			type: "password",
			required: true,
			placeholder: "glpat-...",
			description:
				"A personal, group or project token with read_api and read_repository",
			sensitive: true,
		},
		{
			name: "baseUrl",
			label: "API Base URL",
			type: "string",
			required: false,
			default: "https://gitlab.com/api/v4",
			placeholder: "https://gitlab.com/api/v4",
			description: "For self-managed GitLab, use https://your-host/api/v4",
		},
	],
	requiredPermissions: gitlabTokenPermissions,
	authenticate: {
		headers: { Authorization: "Bearer {{apiKey}}" },
	},
	proxy: {
		baseUrl: "{{baseUrl}}",
		headers: { Accept: "application/json" },
	},
	verify: { method: "GET", path: "/user" },
	gitHost: true,
	connectionCreation: { mode: "form" },
	postIntegrationCreation: { action: "none" },
	display: { authModeLabel: "API Key", listed: false },
};
