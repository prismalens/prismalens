// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PermissionRequirement } from "@prismalens/config/integrations";
import type { AuthTemplate } from "../types.js";

// Bitbucket Cloud scopes: https://developer.atlassian.com/cloud/bitbucket/rest/intro/#scopes
const bitbucketTokenPermissions: PermissionRequirement[] = [
	{
		key: "repository",
		reason:
			"List repositories and commits, read files and clone the repositories bound to a service",
		capabilities: [
			"vcs:list_orgs",
			"vcs:list_repos",
			"vcs:read_commits",
			"vcs:read_file",
		],
	},
];

export const bitbucketToken: AuthTemplate = {
	id: "bitbucket-token",
	name: "Bitbucket Cloud (token)",
	version: "1.0.0",
	category: "vcs",
	authMode: "api_key",
	docsUrl: "https://developer.atlassian.com/cloud/bitbucket/rest/intro/",
	connectionFields: [],
	connectionCredentialFields: [
		{
			name: "apiKey",
			label: "Access token",
			type: "password",
			required: true,
			description:
				"A repository, project or workspace access token with Repository: read",
			sensitive: true,
		},
		{
			name: "baseUrl",
			label: "API Base URL",
			type: "string",
			required: false,
			default: "https://api.bitbucket.org/2.0",
			placeholder: "https://api.bitbucket.org/2.0",
			description: "Bitbucket Cloud only",
		},
	],
	requiredPermissions: bitbucketTokenPermissions,
	authenticate: {
		headers: { Authorization: "Bearer {{apiKey}}" },
	},
	proxy: {
		baseUrl: "{{baseUrl}}",
		headers: { Accept: "application/json" },
	},
	verify: { method: "GET", path: "/repositories?role=member&pagelen=1" },
	gitHost: true,
	connectionCreation: { mode: "form" },
	postIntegrationCreation: { action: "none" },
	display: { authModeLabel: "API Key", listed: false },
};
