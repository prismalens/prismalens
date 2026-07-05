// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PermissionRequirement } from "@prismalens/config/integrations";
import type { AuthTemplate } from "../types.js";

const vercelPermissions: PermissionRequirement[] = [
	{
		key: "api_access",
		reason: "Access Vercel API for deployment management",
		capabilities: [
			"deployment:list_services",
			"deployment:get_service",
			"deployment:list_deploys",
		],
	},
];

export const vercel: AuthTemplate = {
	id: "vercel",
	name: "Vercel",
	version: "1.0.0",
	category: "deployment",
	authMode: "api_key",
	icon: "https://vercel.com/favicon.ico",
	docsUrl: "https://vercel.com/docs/rest-api",
	setupDocsUrl: "https://docs.prismalens.io/integrations/vercel/",
	requiredPermissions: vercelPermissions,
	connectionCredentialFields: [
		{
			name: "apiKey",
			label: "API Token",
			type: "password",
			required: true,
			placeholder: "vercel_...",
			description: "Vercel personal access token or team token",
			sensitive: true,
		},
	],
	authenticate: {
		headers: { Authorization: "Bearer {{apiKey}}" },
	},
	proxy: {
		baseUrl: "https://api.vercel.com",
		headers: { Accept: "application/json" },
	},
	verify: { method: "GET", path: "/v2/user" },
	connectionCreation: { mode: "form" },
	postIntegrationCreation: { action: "none" },
	display: { authModeLabel: "API Token" },
};
