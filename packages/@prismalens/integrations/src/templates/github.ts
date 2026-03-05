import type { AuthTemplate } from "../types.js";

export const githubOAuth2: AuthTemplate = {
	id: "github-oauth2",
	name: "GitHub (OAuth2)",
	category: "vcs",
	authMode: "oauth2",
	icon: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
	docsUrl: "https://docs.github.com/en/rest",
	oauth2: {
		authorizationUrl: "https://github.com/login/oauth/authorize",
		tokenUrl: "https://github.com/login/oauth/access_token",
		scopes: ["repo", "read:org", "read:user"],
		tokensNeverExpire: true,
		clientCredentialSource: "both",
		authorizationParams: {
			allow_signup: "false",
		},
	},
	authenticate: {
		headers: { Authorization: "Bearer {{accessToken}}" },
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

export const githubToken: AuthTemplate = {
	id: "github-token",
	name: "GitHub (PAT)",
	category: "vcs",
	authMode: "api_key",
	icon: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
	docsUrl: "https://docs.github.com/en/rest",
	connectionFields: [
		{
			name: "organization",
			label: "Organization",
			type: "string",
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
			placeholder: "ghp_...",
			description: "Classic PAT or fine-grained token with repo scope",
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
