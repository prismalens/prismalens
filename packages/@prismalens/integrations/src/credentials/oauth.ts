// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * OAuth sign-in (authorization code with PKCE) for GitHub, GitLab and Bitbucket (#848).
 * oauth4webapi does the protocol; this file holds the refresh lock and the token cache.
 */
import { createHash } from "node:crypto";
import type { SourceCredential } from "@prismalens/contracts/schemas";
import * as oauth from "oauth4webapi";
import type { CredentialKind } from "../port/credential-kind.js";
import { SignInExpired } from "./errors.js";
import { withConnectionLock } from "./lock.js";

export type OAuthCredential = Extract<SourceCredential, { kind: "oauth" }>;

/** Test seams only: a mock authorization server on plain http. */
export interface OAuthHttp {
	fetch?: typeof fetch;
	allowInsecure?: boolean;
}

const EARLY_EXPIRY_MS = 60_000;

interface Cached {
	generation: string;
	access: string;
	expiresAt: number;
}
const cache = new Map<string, Cached>();

const generationOf = (c: OAuthCredential) =>
	createHash("sha256")
		.update(c.refreshToken ?? c.accessToken ?? "")
		.digest("hex");

/** Forgets cached access tokens; a test or a deleted connection calls it. */
export function forgetOAuthCache(connectionId?: string): void {
	if (connectionId) cache.delete(connectionId);
	else cache.clear();
}

function server(tokenUrl: string, authorizationUrl?: string) {
	return {
		issuer: new URL(tokenUrl).origin,
		token_endpoint: tokenUrl,
		...(authorizationUrl ? { authorization_endpoint: authorizationUrl } : {}),
	} satisfies oauth.AuthorizationServer;
}

/** GitHub: PKCE plus the secret in the body; Bitbucket: HTTP Basic; GitLab: a public client. */
export function clientAuthFor(
	tokenUrl: string,
	clientSecret: string | undefined,
): oauth.ClientAuth {
	if (!clientSecret) return oauth.None();
	return new URL(tokenUrl).hostname === "bitbucket.org"
		? oauth.ClientSecretBasic(clientSecret)
		: oauth.ClientSecretPost(clientSecret);
}

/** GitHub answers token errors with HTTP 200 and an `error` body; read those as the 400 they are. */
export function tokenFetch(f: typeof fetch = fetch): typeof fetch {
	return async (input, init) => {
		const res = await f(input, init);
		if (res.status !== 200) return res;
		const body = await res
			.clone()
			.json()
			.catch(() => null);
		if (
			body &&
			typeof body === "object" &&
			"error" in body &&
			!("access_token" in body)
		)
			return new Response(JSON.stringify(body), {
				status: 400,
				headers: { "content-type": "application/json" },
			});
		return res;
	};
}

export function httpOptions(http: OAuthHttp = {}, signal?: AbortSignal) {
	return {
		[oauth.customFetch]: tokenFetch(http.fetch),
		...(http.allowInsecure ? { [oauth.allowInsecureRequests]: true } : {}),
		...(signal ? { signal } : {}),
	};
}

export interface SignInStart {
	authorizationUrl: string;
	verifier: string;
	state: string;
}

/** The authorization URL with PKCE (S256) and a fresh state. */
export async function beginSignIn(p: {
	authorizationUrl: string;
	clientId: string;
	redirectUri: string;
	scopes: readonly string[];
}): Promise<SignInStart> {
	const verifier = oauth.generateRandomCodeVerifier();
	const state = oauth.generateRandomState();
	const url = new URL(p.authorizationUrl);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", p.clientId);
	url.searchParams.set("redirect_uri", p.redirectUri);
	url.searchParams.set(
		"code_challenge",
		await oauth.calculatePKCECodeChallenge(verifier),
	);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);
	if (p.scopes.length) url.searchParams.set("scope", p.scopes.join(" "));
	return { authorizationUrl: url.href, verifier, state };
}

export interface SignInResult {
	credential: OAuthCredential;
	/** null when the response named no scope. */
	grantedScopes: string[] | null;
	accessToken: string;
	expiresAt: number;
}

/** Validates the callback against `state` and exchanges the code with the stored verifier. */
export async function completeSignIn(
	p: {
		authorizationUrl: string;
		tokenUrl: string;
		redirectUri: string;
		clientId: string;
		clientSecret?: string;
		scopes: string[];
		verifier: string;
		state: string;
		callback: URL | URLSearchParams;
	},
	http: OAuthHttp = {},
): Promise<SignInResult> {
	const as = server(p.tokenUrl, p.authorizationUrl);
	const client: oauth.Client = { client_id: p.clientId };
	const params = oauth.validateAuthResponse(as, client, p.callback, p.state);
	const res = await oauth.authorizationCodeGrantRequest(
		as,
		client,
		clientAuthFor(p.tokenUrl, p.clientSecret),
		params,
		p.redirectUri,
		p.verifier,
		httpOptions(http),
	);
	const t = await oauth.processAuthorizationCodeResponse(as, client, res);
	const credential: OAuthCredential = {
		kind: "oauth",
		authorizationUrl: p.authorizationUrl,
		tokenUrl: p.tokenUrl,
		redirectUri: p.redirectUri,
		clientId: p.clientId,
		...(p.clientSecret ? { clientSecret: p.clientSecret } : {}),
		scopes: p.scopes,
		// Refresh follows the response, never a provider flag (OBJ-022).
		...(t.refresh_token
			? { refreshToken: t.refresh_token }
			: { accessToken: t.access_token }),
	};
	return {
		credential,
		grantedScopes: grantedOf(t.scope),
		accessToken: t.access_token,
		expiresAt: expiryOf(t.expires_in),
	};
}

const grantedOf = (scope: unknown) =>
	typeof scope === "string" && scope.trim()
		? scope.split(/[\s,]+/).filter(Boolean)
		: null;

const expiryOf = (expiresIn: number | undefined) =>
	expiresIn === undefined
		? Number.POSITIVE_INFINITY
		: Date.now() + expiresIn * 1000 - EARLY_EXPIRY_MS;

/** Seeds the cache with the token a sign-in just returned, so the first probe does not refresh. */
export function primeOAuthCache(
	connectionId: string,
	s: Pick<SignInResult, "credential" | "accessToken" | "expiresAt">,
): void {
	cache.set(connectionId, {
		generation: generationOf(s.credential),
		access: s.accessToken,
		expiresAt: s.expiresAt,
	});
}

function isInvalidGrant(e: unknown): boolean {
	if (!(e instanceof oauth.ResponseBodyError)) return false;
	return e.error === "invalid_grant" || e.error === "bad_refresh_token";
}

async function refresh(
	c: OAuthCredential & { refreshToken: string },
	http: OAuthHttp,
	signal?: AbortSignal,
): Promise<oauth.TokenEndpointResponse> {
	const as = server(c.tokenUrl, c.authorizationUrl);
	const client: oauth.Client = { client_id: c.clientId };
	const res = await oauth.refreshTokenGrantRequest(
		as,
		client,
		clientAuthFor(c.tokenUrl, c.clientSecret),
		c.refreshToken,
		{
			...httpOptions(http, signal),
			// GitLab wants the original redirect URI on refresh (OBJ-008).
			additionalParameters: { redirect_uri: c.redirectUri },
		},
	);
	return oauth.processRefreshTokenResponse(as, client, res);
}

const bearerHeaders = (access: string) => ({
	headers: { Authorization: `Bearer ${access}` },
});

/** Builds the kind; `http` is a test seam. */
export function oauthKind(http: OAuthHttp = {}): CredentialKind<"oauth"> {
	return {
		kind: "oauth",
		enrol: "sign-in",
		secrets: (c, ctx) =>
			[
				c.refreshToken,
				c.accessToken,
				c.clientSecret,
				cache.get(ctx.connectionId)?.access,
			].filter((s): s is string => !!s),
		async authorize(c, ctx, opts) {
			const fresh = (hit: Cached | undefined, gen: string) =>
				hit &&
				hit.generation === gen &&
				hit.expiresAt > Date.now() &&
				hit.access !== opts?.renew?.failedToken;
			const early = cache.get(ctx.connectionId);
			if (fresh(early, generationOf(c)) && early)
				return bearerHeaders(early.access);
			return withConnectionLock(ctx.connectionId, async () => {
				let current = await loadOAuth(ctx.load);
				const hit = cache.get(ctx.connectionId);
				// A stale caller uses what the lock holder stored (OBJ-007).
				if (fresh(hit, generationOf(current)) && hit)
					return bearerHeaders(hit.access);
				if (!current.refreshToken) {
					const access = current.accessToken;
					if (!access || access === opts?.renew?.failedToken)
						throw new SignInExpired();
					cache.set(ctx.connectionId, {
						generation: generationOf(current),
						access,
						expiresAt: Number.POSITIVE_INFINITY,
					});
					return bearerHeaders(access);
				}
				let t: oauth.TokenEndpointResponse;
				try {
					t = await refresh(
						current as OAuthCredential & { refreshToken: string },
						http,
						ctx.signal,
					);
				} catch (e) {
					if (!isInvalidGrant(e)) throw e;
					const reread = await loadOAuth(ctx.load);
					if (
						!reread.refreshToken ||
						reread.refreshToken === current.refreshToken
					)
						throw new SignInExpired();
					current = reread;
					try {
						t = await refresh(
							current as OAuthCredential & { refreshToken: string },
							http,
							ctx.signal,
						);
					} catch (again) {
						if (isInvalidGrant(again)) throw new SignInExpired();
						throw again;
					}
				}
				let next = current;
				if (t.refresh_token && t.refresh_token !== current.refreshToken) {
					next = { ...current, refreshToken: t.refresh_token };
					// Written back before the cache moves to the new generation.
					await ctx.save(next);
				}
				cache.set(ctx.connectionId, {
					generation: generationOf(next),
					access: t.access_token,
					expiresAt: expiryOf(t.expires_in),
				});
				return bearerHeaders(t.access_token);
			});
		},
	};
}

async function loadOAuth(
	load: () => Promise<SourceCredential>,
): Promise<OAuthCredential> {
	const c = await load();
	if (c.kind !== "oauth") throw new SignInExpired();
	return c;
}

export const oauthCredential = oauthKind();
