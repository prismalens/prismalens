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
import { inspect } from "node:util";
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
		fetchMock.mockResolvedValue(new Response("bad code", { status: 400 }));

		// Status-level diagnostics only — the body ("bad code") is not read and
		// never reaches the message. See #347 F1 and the leak suite below.
		await expect(
			flow.exchangeCodeForTokens(
				TEMPLATE,
				"auth-code",
				oauthState(),
				"client-abc",
				"secret-xyz",
			),
		).rejects.toThrow(
			"OAuth token exchange failed for provider 'acme' (HTTP 400 Bad Request)",
		);
	});

	it("throws when the provider returns a 200 with an OAuth error body, naming only the registered error code", async () => {
		const { flow } = makeFlow();
		fetchMock.mockResolvedValue(
			jsonResponse({
				error: "invalid_grant",
				error_description: "code already used",
			}),
		);

		const error = await flow
			.exchangeCodeForTokens(
				TEMPLATE,
				"auth-code",
				oauthState(),
				"client-abc",
				"secret-xyz",
			)
			.catch((e: unknown) => e as Error);

		// The registered code survives (it is the diagnostic); the provider's
		// free-text description does not.
		expect(error.message).toBe(
			"OAuth token exchange failed for provider 'acme': provider returned error 'invalid_grant' in a 200 response",
		);
		expect(error.message).not.toContain("code already used");
	});

	it("reports an unregistered OAuth error code as unrecognized rather than echoing it", async () => {
		const { flow } = makeFlow();
		fetchMock.mockResolvedValue(
			jsonResponse({ error: "ghp_totally_not_an_error_code" }),
		);

		await expect(
			flow.exchangeCodeForTokens(
				TEMPLATE,
				"auth-code",
				oauthState(),
				"client-abc",
				"secret-xyz",
			),
		).rejects.toThrow(
			"provider returned error 'unrecognized_error_code' in a 200 response",
		);
	});

	it("throws on a malformed (non-JSON) provider response without quoting it", async () => {
		const { flow } = makeFlow();
		fetchMock.mockResolvedValue(new Response("<html>502</html>", { status: 200 }));

		// Not the raw SyntaxError: JSON.parse quotes the offending input, which
		// is the provider's body.
		await expect(
			flow.exchangeCodeForTokens(
				TEMPLATE,
				"auth-code",
				oauthState(),
				"client-abc",
				"secret-xyz",
			),
		).rejects.toThrow(
			"OAuth token exchange failed for provider 'acme': provider returned a 200 response that is not valid JSON",
		);
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

	// Asymmetry, pinned deliberately rather than fixed here (#391).
	//
	// startAuthorization interpolates authorizationUrl against connectionConfig
	// (see "interpolates the authorization URL from the connection config"), but
	// exchangeCodeForTokens interpolates tokenUrl against an EMPTY context:
	//   oauth2-flow.ts -> interpolate(template.oauth2.tokenUrl, {})
	// and interpolate() THROWS on a key it cannot resolve. So a tenant-templated
	// template authorizes fine — the user completes the provider consent screen —
	// and then the callback throws. Half-working, not silently wrong.
	//
	// This test locks in the current, throwing behaviour so the asymmetry is
	// documented and a regression is visible. Making tokenUrl interpolate for
	// real is a behaviour change (the decrypted connectionConfig has to be
	// threaded from the state row into the exchange) and belongs with the other
	// escalations from this PR, not inside a test-only change. Tracked in #391 —
	// update this test as part of that fix rather than deleting it.
	it("throws on a templated tokenUrl — tokenUrl is NOT interpolated from the connection config, unlike authorizationUrl", async () => {
		const { flow } = makeFlow();
		fetchMock.mockResolvedValue(jsonResponse({ access_token: "at" }));

		await expect(
			flow.exchangeCodeForTokens(
				templateWith({
					authorizationUrl: "https://{{subdomain}}.acme.test/oauth/authorize",
					tokenUrl: "https://{{subdomain}}.acme.test/oauth/token",
				}),
				"auth-code",
				oauthState(),
				"client-abc",
				"secret-xyz",
			),
		).rejects.toThrow("Interpolation failed: {{subdomain}} not found in context");

		// The provider is never contacted: it fails before the round-trip.
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

// #347 F1 — the token exchange is the one call that carries the authorization
// code and the client secret, and a token endpoint routinely echoes what it
// was sent back in its error body. The OAuth callback handler logs the caught
// error (oauth.controller.ts), so anything the error carries is written to
// disk. These tests fail against the pre-fix code, which interpolated the full
// response body into the message.
describe("OAuth2Flow.exchangeCodeForTokens — provider payloads never reach the error", () => {
	const SENTINEL = "sk-SENTINEL-DO-NOT-LOG";
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	/** Every string a logger or crash reporter could pull out of a thrown error. */
	function errorSurfaces(error: unknown): Record<string, string> {
		const err = error as Error;
		return {
			message: err.message,
			string: String(err),
			stack: err.stack ?? "",
			json: JSON.stringify(err),
			jsonAllProps: JSON.stringify(err, Object.getOwnPropertyNames(err)),
			inspect: inspect(err, { depth: null }),
		};
	}

	function expectNoSentinel(error: unknown): Error {
		for (const [surface, text] of Object.entries(errorSurfaces(error))) {
			expect(text, `sentinel leaked via error ${surface}`).not.toContain(
				SENTINEL,
			);
			// Not even a recognisable fragment of it.
			expect(text, `sentinel fragment leaked via error ${surface}`).not.toMatch(
				/SENTINEL/i,
			);
		}
		return error as Error;
	}

	async function exchangeAndCatch(): Promise<unknown> {
		const { flow } = makeFlow();
		return flow
			.exchangeCodeForTokens(
				TEMPLATE,
				"auth-code",
				oauthState({ codeVerifier: "verifier-123" }),
				"client-abc",
				"secret-xyz",
			)
			.then(
				() => {
					throw new Error("expected exchangeCodeForTokens to reject");
				},
				(e: unknown) => e,
			);
	}

	it("keeps a secret in a non-2xx response body out of the thrown error", async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({
					error: "invalid_grant",
					error_description: `token was ${SENTINEL}`,
					access_token: SENTINEL,
				}),
				{ status: 400 },
			),
		);

		const error = expectNoSentinel(await exchangeAndCatch());

		// Still useful: which operation, which provider, which HTTP status.
		expect(error.message).toBe(
			"OAuth token exchange failed for provider 'acme' (HTTP 400 Bad Request)",
		);
	});

	it("keeps a secret in a 200 OAuth-error body out of the thrown error", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				error: SENTINEL,
				error_description: `refresh token ${SENTINEL} is invalid`,
			}),
		);

		const error = expectNoSentinel(await exchangeAndCatch());

		expect(error.message).toBe(
			"OAuth token exchange failed for provider 'acme': provider returned error 'unrecognized_error_code' in a 200 response",
		);
	});

	it("keeps a secret in the HTTP reason phrase out of the thrown error", async () => {
		// `statusText` is provider-controlled text on the status line, so the
		// reason phrase is looked up from the status code rather than echoed.
		fetchMock.mockResolvedValue(
			new Response("{}", { status: 403, statusText: SENTINEL }),
		);

		const error = expectNoSentinel(await exchangeAndCatch());

		expect(error.message).toBe(
			"OAuth token exchange failed for provider 'acme' (HTTP 403 Forbidden)",
		);
	});

	it("keeps a secret in a malformed 2xx body out of the JSON parse failure", async () => {
		// A truncated token response is the realistic case: the parse error
		// quotes the input, and the input is the token.
		fetchMock.mockResolvedValue(
			new Response(`{"access_token":"${SENTINEL}"`, {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		const error = expectNoSentinel(await exchangeAndCatch());

		expect(error.message).toBe(
			"OAuth token exchange failed for provider 'acme': provider returned a 200 response that is not valid JSON",
		);
	});

	it("does not even read the body of a non-2xx response", async () => {
		const response = new Response(SENTINEL, { status: 500 });
		fetchMock.mockResolvedValue(response);

		expectNoSentinel(await exchangeAndCatch());
		expect(response.bodyUsed).toBe(false);
	});

	it("keeps our own request credentials out of the thrown error", async () => {
		fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));

		const error = (await exchangeAndCatch()) as Error;
		const surfaces = Object.values(errorSurfaces(error)).join("\n");

		for (const secret of ["secret-xyz", "auth-code", "verifier-123"]) {
			expect(surfaces, `request credential '${secret}' leaked`).not.toContain(
				secret,
			);
		}
	});
});
