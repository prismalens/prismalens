// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AuthTemplate } from "../types.js";

/** A token git sends over HTTPS to one host. No adapter: cloning needs no API (#673). */
export const gitHostToken: AuthTemplate = {
	id: "git-host-token",
	name: "Git host token",
	version: "1.0.0",
	category: "git",
	authMode: "api_key",
	connectionFields: [
		{
			name: "host",
			label: "Host",
			type: "string",
			required: true,
			default: "github.com",
			placeholder: "github.com",
			description:
				"github.com, gitlab.com, bitbucket.org, or your own git host, with :port if it has one",
		},
	],
	connectionCredentialFields: [
		{
			name: "token",
			label: "Token",
			type: "password",
			required: true,
			sensitive: true,
			description:
				"Read access to the repositories your runs read. GitHub: a fine-grained token with Contents: read on them. GitLab: a project or personal token with read_repository. Bitbucket Cloud: a repository access token with Repository: read.",
		},
	],
	gitHost: true,
	authenticate: {},
	proxy: { baseUrl: "https://{{host}}" },
	connectionCreation: { mode: "form" },
	postIntegrationCreation: { action: "none" },
	display: { authModeLabel: "Token" },
};
