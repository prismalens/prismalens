import type { AuthTemplate } from "../types.js";

export const render: AuthTemplate = {
	id: "render",
	name: "Render",
	category: "observability",
	authMode: "api_key",
	icon: "https://render.com/favicon.ico",
	docsUrl: "https://docs.render.com/api",
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
