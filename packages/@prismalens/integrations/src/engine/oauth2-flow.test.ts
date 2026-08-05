// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * OAuth2 authorization-code flow (#253): authorization-URL construction with
 * PKCE, the CSRF state token written to the store, and the token exchange
 * itself. The exchange is the credential-minting step — a non-2xx, an OAuth
 * error body or a malformed provider response must raise, never produce a
 * half-populated credential. Hermetic — fetch stubbed, state store in-memory.
 *
 * State *consumption* is not covered here: it lives in the caller
 * (packages/api's OAuthService.handleCallback), not in this package.
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthTemplate, OAuthStateData } from "../types.js";
import { OAuth2Flow, type OAuth2StoreDeps } from "./oauth2-flow.js";
import { TokenVault } from "./token-vault.js";

const VAULT = new TokenVault(Buffer.alloc(32, 0x7f));

const TEMPLATE: AuthTemplate = {
	id: "acme",
	name: "Acme",
	version: "1.0.0",
	category: "vcs",
	authMode: "oauth2",
	oauth2: {
		authorizationUrl: "https://acme.test/oauth/authorize",
		tokenUrl: "https://acme.test/oauth/token",
		scopeSeparator: " ",
		tokenAuthMethod: "body",
	},
	authenticate: { headers: { Authorization: "Bearer {{accessToken}}" } },
	proxy: { baseUrl: "https://api.acme.test" },
	connectionCreation: { mode: "oauth_redirect" },
	postIntegrationCreation: { action: "oauth_redirect" },
	display: { authModeLabel: "OAuth2" },
};

function templateWith(oauth2: Partial<NonNullable<AuthTemplate["oauth2"]>>) {
	return {
		...TEMPLATE,
		oauth2: { ...TEMPLATE.oauth2, ...oauth2 },
	} as AuthTemplate;
}

/** In-memory stand-in for the DB-backed OAuth state store. */
class MemoryStateStore implements OAuth2StoreDeps {
	readonly states = new Map<string, OAuthStateData>();

	async saveOAuthState(data: OAuthStateData): Promise<void> {
		this.states.set(data.state, data);
	}

	// Required by OAuth2StoreDeps — the api implements the same contract and
	// consumes state itself; OAuth2Flow only ever writes it.
	async getOAuthState(stateToken: string): Promise<OAuthStateData | null> {
		return this.states.get(stateToken) ?? null;
	}

	async deleteOAuthState(stateToken: string): Promise<void> {
		this.states.delete(stateToken);
	}
}

function makeFlow(): { flow: OAuth2Flow; store: MemoryStateStore } {
	const store = new MemoryStateStore();
	return { flow: new OAuth2Flow(VAULT, store), store };
}

const BASE_PARAMS = {
	template: TEMPLATE,
	integrationId: "int_1",
	userId: "user_1",
	clientId: "client-abc",
	callbackUrl: "https://prismalens.test/oauth/callback",
	scopes: ["repo", "read:org"],
};

function oauthState(overrides: Partial<OAuthStateData> = {}): OAuthStateData {
	return {
		state: "state-token",
		integrationId: "int_1",
		userId: "user_1",
		callbackUrl: "https://prismalens.test/oauth/callback",
		codeVerifier: null,
		expiresAt: new Date(Date.now() + 600_000),
		...overrides,
	};
}

function formBody(init: RequestInit): URLSearchParams {
	return new URLSearchParams(init.body as unknown as string);
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("OAuth2Flow.startAuthorization", () => {
	it("builds the authorization URL with the standard code-flow parameters", async () => {
		const { flow } = makeFlow();

		const { url, state } = await flow.startAuthorization(BASE_PARAMS);
		const parsed = new URL(url);

		expect(`${parsed.origin}${parsed.pathname}`).toBe(
			"https://acme.test/oauth/authorize",
		);
		expect(parsed.searchParams.get("client_id")).toBe("client-abc");
		expect(parsed.searchParams.get("redirect_uri")).toBe(
			BASE_PARAMS.callbackUrl,
		);
		expect(parsed.searchParams.get("response_type")).toBe("code");
		expect(parsed.searchParams.get("scope")).toBe("repo read:org");
		expect(parsed.searchParams.get("state")).toBe(state);
	});

	it("mints a high-entropy, non-repeating state token", async () => {
		const { flow } = makeFlow();
		const states = new Set<string>();

		for (let i = 0; i < 50; i++) {
			const { state } = await flow.startAuthorization(BASE_PARAMS);
			expect(state).toMatch(/^[0-9a-f]{64}$/);
			states.add(state);
		}

		expect(states.size).toBe(50);
	});

	it("attaches an S256 PKCE challenge derived from the stored verifier", async () => {
		const { flow, store } = makeFlow();

		const { url, state } = await flow.startAuthorization(BASE_PARAMS);
		const parsed = new URL(url);
		const saved = store.states.get(state);

		expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
		expect(saved?.codeVerifier).toBeTruthy();
		expect(parsed.searchParams.get("code_challenge")).toBe(
			createHash("sha256")
				.update(saved?.codeVerifier as string)
				.digest("base64url"),
		);
	});

	it("omits PKCE when the template disables it", async () => {
		const { flow, store } = makeFlow();

		const { url, state } = await flow.startAuthorization({
			...BASE_PARAMS,
			template: templateWith({ disablePkce: true }),
		});
		const parsed = new URL(url);

		expect(parsed.searchParams.get("code_challenge")).toBeNull();
		expect(parsed.searchParams.get("code_challenge_method")).toBeNull();
		expect(store.states.get(state)?.codeVerifier).toBeNull();
	});

	it("honours a custom scope separator and extra authorization params", async () => {
		const { flow } = makeFlow();

		const { url } = await flow.startAuthorization({
			...BASE_PARAMS,
			template: templateWith({
				scopeSeparator: ",",
				authorizationParams: { prompt: "consent", access_type: "offline" },
			}),
		});
		const parsed = new URL(url);

		expect(parsed.searchParams.get("scope")).toBe("repo,read:org");
		expect(parsed.searchParams.get("prompt")).toBe("consent");
		expect(parsed.searchParams.get("access_type")).toBe("offline");
	});

	it("encrypts the connection config into the stored state", async () => {
		const { flow, store } = makeFlow();
		const connectionConfig = { subdomain: "acme-corp", region: "eu" };

		const { state } = await flow.startAuthorization({
			...BASE_PARAMS,
			connectionConfig,
		});
		const saved = store.states.get(state);

		expect(saved?.connectionConfigEnc).toBeInstanceOf(Buffer);
		expect(
			(saved?.connectionConfigEnc as Buffer).includes(
				Buffer.from("acme-corp"),
			),
		).toBe(false);
		expect(VAULT.decryptJSON(saved?.connectionConfigEnc as Buffer)).toEqual(
			connectionConfig,
		);
	});

	it("stores a null connection config when none is supplied", async () => {
		const { flow, store } = makeFlow();
		const { state } = await flow.startAuthorization(BASE_PARAMS);
		expect(store.states.get(state)?.connectionConfigEnc).toBeNull();
	});

	it("gives the state a 10-minute lifetime", async () => {
		const { flow, store } = makeFlow();
		const before = Date.now();

		const { state } = await flow.startAuthorization(BASE_PARAMS);
		const expiresAt = store.states.get(state)?.expiresAt as Date;

		expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 600_000);
		expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 600_000);
	});

	it("interpolates the authorization URL from the connection config", async () => {
		const { flow } = makeFlow();

		const { url } = await flow.startAuthorization({
			...BASE_PARAMS,
			template: templateWith({
				authorizationUrl: "https://{{subdomain}}.acme.test/oauth/authorize",
			}),
			connectionConfig: { subdomain: "acme-corp" },
		});

		expect(url.startsWith("https://acme-corp.acme.test/oauth/authorize?")).toBe(
			true,
		);
	});

	it("throws when the template has no oauth2 config", async () => {
		const { flow } = makeFlow();
		const { oauth2: _dropped, ...withoutOauth } = TEMPLATE;

		await expect(
			flow.startAuthorization({
				...BASE_PARAMS,
				template: withoutOauth as AuthTemplate,
			}),
		).rejects.toThrow("Template 'acme' does not have oauth2 config");
	});
});

describe("OAuth2Flow.exchangeCodeForTokens", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("exchanges an authorization code for tokens (the #253 falsifier)", async () => {
		const { flow } = makeFlow();
		fetchMock.mockResolvedValue(
			jsonResponse({
				access_token: "at_live",
				refresh_token: "rt_live",
				token_type: "Bearer",
				expires_in: 3600,
				scope: "repo read:org",
			}),
		);

		const result = await flow.exchangeCodeForTokens(
			TEMPLATE,
			"auth-code",
			oauthState(),
			"client-abc",
			"secret-xyz",
		);

		expect(result).toEqual({
			accessToken: "at_live",
			refreshToken: "rt_live",
			tokenType: "Bearer",
			expiresIn: 3600,
			grantedScopes: ["repo", "read:org"],
			metadata: undefined,
		});
	});

	it("POSTs the authorization_code grant with client credentials in the body", async () => {
		const { flow } = makeFlow();
		fetchMock.mockResolvedValue(jsonResponse({ access_token: "at" }));

		await flow.exchangeCodeForTokens(
			TEMPLATE,
			"auth-code",
			oauthState(),
			"client-abc",
			"secret-xyz",
		);

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://acme.test/oauth/token");
		expect(init.method).toBe("POST");
		const body = formBody(init);
		expect(body.get("grant_type")).toBe("authorization_code");
		expect(body.get("code")).toBe("auth-code");
		expect(body.get("redirect_uri")).toBe(
			"https://prismalens.test/oauth/callback",
		);
		expect(body.get("client_id")).toBe("client-abc");
		expect(body.get("client_secret")).toBe("secret-xyz");
		expect(
			(init.headers as Record<string, string>).Authorization,
		).toBeUndefined();
	});

	it("uses HTTP Basic auth and keeps the secret out of the body when configured", async () => {
		const { flow } = makeFlow();
		fetchMock.mockResolvedValue(jsonResponse({ access_token: "at" }));

		await flow.exchangeCodeForTokens(
			templateWith({ tokenAuthMethod: "header" }),
			"auth-code",
			oauthState(),
			"client-abc",
			"secret-xyz",
		);

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>).Authorization).toBe(
			`Basic ${Buffer.from("client-abc:secret-xyz").toString("base64")}`,
		);
		const body = formBody(init);
		expect(body.get("client_secret")).toBeNull();
		expect(body.get("client_id")).toBeNull();
	});

	it("sends the PKCE code_verifier when the state carries one", async () => {
		const { flow } = makeFlow();
		fetchMock.mockResolvedValue(jsonResponse({ access_token: "at" }));

		await flow.exchangeCodeForTokens(
			TEMPLATE,
			"auth-code",
			oauthState({ codeVerifier: "verifier-123" }),
			"client-abc",
			"secret-xyz",
		);

		expect(formBody(fetchMock.mock.calls[0][1]).get("code_verifier")).toBe(
			"verifier-123",
		);
	});

	it("omits code_verifier when PKCE was not used", async () => {
		const { flow } = makeFlow();
		fetchMock.mockResolvedValue(jsonResponse({ access_token: "at" }));

		await flow.exchangeCodeForTokens(
			TEMPLATE,
			"auth-code",
			oauthState({ codeVerifier: null }),
			"client-abc",
			"secret-xyz",
		);

		expect(formBody(fetchMock.mock.calls[0][1]).get("code_verifier")).toBeNull();
	});

	it("defaults tokenType and nulls the refresh token when the provider omits them", async () => {
		const { flow } = makeFlow();
		fetchMock.mockResolvedValue(jsonResponse({ access_token: "at_only" }));

		const result = await flow.exchangeCodeForTokens(
			TEMPLATE,
			"auth-code",
			oauthState(),
			"client-abc",
			"secret-xyz",
		);

		expect(result.accessToken).toBe("at_only");
		expect(result.refreshToken).toBeNull();
		expect(result.tokenType).toBe("bearer");
		expect(result.expiresIn).toBeNull();
		expect(result.grantedScopes).toBeUndefined();
	});

	it("extracts nested metadata declared by the template", async () => {
		const { flow } = makeFlow();
		fetchMock.mockResolvedValue(
			jsonResponse({
				access_token: "at",
				team: { id: "T123", name: "Acme" },
				bot_user_id: "B1",
			}),
		);

		const result = await flow.exchangeCodeForTokens(
			templateWith({ tokenResponseMetadata: ["team.id", "bot_user_id", "nope.missing"] }),
			"auth-code",
			oauthState(),
			"client-abc",
			"secret-xyz",
		);

		expect(result.metadata).toEqual({ team_id: "T123", bot_user_id: "B1" });
	});

	it("splits granted scopes on the template separator", async () => {
		const { flow } = makeFlow();
		fetchMock.mockResolvedValue(
			jsonResponse({ access_token: "at", scope: "a,b,c" }),
		);

		const result = await flow.exchangeCodeForTokens(
			templateWith({ scopeSeparator: "," }),
			"auth-code",
			oauthState(),
			"client-abc",
			"secret-xyz",
		);

		expect(result.grantedScopes).toEqual(["a", "b", "c"]);
	});

	it("throws on a non-2xx provider response instead of returning a credential", async () => {
		const { flow } = makeFlow();
		fetchMock.mockResolvedValue(
			new Response("bad code", { status: 400 }),
		);

		await expect(
			flow.exchangeCodeForTokens(
				TEMPLATE,
				"auth-code",
				oauthState(),
				"client-abc",
				"secret-xyz",
			),
		).rejects.toThrow("Token exchange failed (400): bad code");
	});

	it("throws when the provider returns a 200 with an OAuth error body", async () => {
		const { flow } = makeFlow();
		fetchMock.mockResolvedValue(
			jsonResponse({
				error: "invalid_grant",
				error_description: "code already used",
			}),
		);

		await expect(
			flow.exchangeCodeForTokens(
				TEMPLATE,
				"auth-code",
				oauthState(),
				"client-abc",
				"secret-xyz",
			),
		).rejects.toThrow("OAuth error: code already used");
	});

	it("throws on a malformed (non-JSON) provider response", async () => {
		const { flow } = makeFlow();
		fetchMock.mockResolvedValue(new Response("<html>502</html>", { status: 200 }));

		await expect(
			flow.exchangeCodeForTokens(
				TEMPLATE,
				"auth-code",
				oauthState(),
				"client-abc",
				"secret-xyz",
			),
		).rejects.toThrow(SyntaxError);
	});

	it("throws when a 200 response carries no access token (half-populated credential)", async () => {
		const { flow } = makeFlow();
		fetchMock.mockResolvedValue(
			jsonResponse({ token_type: "bearer", expires_in: 3600 }),
		);

		await expect(
			flow.exchangeCodeForTokens(
				TEMPLATE,
				"auth-code",
				oauthState(),
				"client-abc",
				"secret-xyz",
			),
		).rejects.toThrow(/access_token/);
	});

	it("throws when a 200 response carries a whitespace-only access token", async () => {
		const { flow } = makeFlow();
		fetchMock.mockResolvedValue(jsonResponse({ access_token: "   " }));

		await expect(
			flow.exchangeCodeForTokens(
				TEMPLATE,
				"auth-code",
				oauthState(),
				"client-abc",
				"secret-xyz",
			),
		).rejects.toThrow(/access_token/);
	});

	it("throws when the template has no oauth2 config", async () => {
		const { flow } = makeFlow();
		const { oauth2: _dropped, ...withoutOauth } = TEMPLATE;

		await expect(
			flow.exchangeCodeForTokens(
				withoutOauth as AuthTemplate,
				"auth-code",
				oauthState(),
				"client-abc",
				"secret-xyz",
			),
		).rejects.toThrow("Template 'acme' has no oauth2 config");
	});
});
