import type { PermissionRequirement } from "@prismalens/config/integrations";
import type { AuthTemplate } from "../types.js";

const renderPermissions: PermissionRequirement[] = [
	{
		key: "api_access",
		reason: "Access Render API for service monitoring",
		capabilities: ["monitoring:read"],
	},
];

export const render: AuthTemplate = {
	id: "render",
	name: "Render",
	version: "1.0.0",
	category: "observability",
	authMode: "api_key",
	icon: "https://render.com/favicon.ico",
	docsUrl: "https://docs.render.com/api",
	setupDocsUrl: "https://docs.prismalens.io/integrations/render/",
	requiredPermissions: renderPermissions,
	credentialFields: [
		{
			name: "apiKey",
			label: "API Key",
			type: "password",
			required: true,
			placeholder: "rnd_...",
			description: "Render API key",
			sensitive: true,
		},
	],
	authenticate: {
		headers: { Authorization: "Bearer {{apiKey}}" },
	},
	proxy: {
		baseUrl: "https://api.render.com",
		headers: { "Content-Type": "application/json" },
	},
	verify: { method: "GET", path: "/v1/owners" },
};
