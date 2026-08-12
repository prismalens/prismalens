// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Template-driven OAuth2 authorization flow with PKCE support.
 * DB-backed state via injected interface — no NestJS dependency.
 */
import { createHash, randomBytes } from "node:crypto";
import type { AuthTemplate, OAuthStateData, TokenResult } from "../types.js";
import { interpolate } from "./interpolate.js";
import {
	providerHttpError,
	providerJsonParseError,
} from "./provider-http-error.js";
import type { TokenVault } from "./token-vault.js";

/**
 * The OAuth2 token-endpoint error codes we are willing to name in a log line
 * (RFC 6749 §5.2 plus the device-flow codes of RFC 8628 §3.5).
 */
const OAUTH2_ERROR_CODES: ReadonlySet<string> = new Set([
	"access_denied",
	"authorization_pending",
	"expired_token",
	"invalid_client",
	"invalid_grant",
	"invalid_request",
	"invalid_scope",
	"slow_down",
	"unauthorized_client",
	"unsupported_grant_type",
]);

/**
 * Fence the provider-supplied `error` field by enumeration rather than by
 * shape: a bearer token is itself a short token-shaped string, so any
 * "looks like a code" filter would pass it straight through. Anything not on
 * the registered list is reported as unrecognised, never echoed.
 */
function safeOAuthErrorCode(value: unknown): string {
	return typeof value === "string" && OAUTH2_ERROR_CODES.has(value)
		? value
		: "unrecognized_error_code";
}

export interface OAuth2StoreDeps {
	saveOAuthState(data: OAuthStateData): Promise<void>;
	getOAuthState(stateToken: string): Promise<OAuthStateData | null>;
	deleteOAuthState(stateToken: string): Promise<void>;
}

export interface StartAuthorizationParams {
	template: AuthTemplate;
	integrationId: string;
	userId: string;
	organizationId?: string;
	clientId: string;
	callbackUrl: string;
	scopes: string[];
	connectionConfig?: Record<string, string>;
}

export class OAuth2Flow {
	constructor(
		private readonly vault: TokenVault,
		private readonly deps: OAuth2StoreDeps,
	) {}

	async startAuthorization(
		params: StartAuthorizationParams,
	): Promise<{ url: string; state: string }> {
		const {
			template,
			integrationId,
			userId,
			organizationId,
			clientId,
			callbackUrl,
			scopes,
			connectionConfig,
		} = params;

		if (!template.oauth2) {
			throw new Error(`Template '${template.id}' does not have oauth2 config`);
		}

		const state = randomBytes(32).toString("hex");

		let codeVerifier: string | null = null;
		let codeChallenge: string | null = null;
		if (!template.oauth2.disablePkce) {
			codeVerifier = randomBytes(32).toString("base64url");
			codeChallenge = createHash("sha256")
				.update(codeVerifier)
				.digest("base64url");
		}

		await this.deps.saveOAuthState({
			state,
			integrationId,
			userId,
			organizationId,
			callbackUrl,
			connectionConfigEnc: connectionConfig
				? this.vault.encryptJSON(connectionConfig)
				: null,
			codeVerifier,
			expiresAt: new Date(Date.now() + 10 * 60 * 1000),
		});

		const separator = template.oauth2.scopeSeparator ?? " ";
		const context: Record<string, string> = connectionConfig ?? {};

		const urlParams = new URLSearchParams({
			client_id: clientId,
			redirect_uri: callbackUrl,
			response_type: "code",
			state,
			scope: scopes.join(separator),
			...template.oauth2.authorizationParams,
		});

		if (codeChallenge) {
			urlParams.set("code_challenge", codeChallenge);
			urlParams.set("code_challenge_method", "S256");
		}

		const authUrl = interpolate(template.oauth2.authorizationUrl, context);
		return { url: `${authUrl}?${urlParams.toString()}`, state };
	}

	/**
	 * Full token exchange with a known template.
	 */
	async exchangeCodeForTokens(
		template: AuthTemplate,
		code: string,
		oauthState: OAuthStateData,
		clientId: string,
		clientSecret: string,
	): Promise<TokenResult> {
		if (!template.oauth2) {
			throw new Error(`Template '${template.id}' has no oauth2 config`);
		}

		const tokenBody: Record<string, string> = {
			grant_type: "authorization_code",
			code,
			redirect_uri: oauthState.callbackUrl,
		};

		if (oauthState.codeVerifier) {
			tokenBody.code_verifier = oauthState.codeVerifier;
		}

		const tokenHeaders: Record<string, string> = {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		};

		if (template.oauth2.tokenAuthMethod === "header") {
			const basic = Buffer.from(`${clientId}:${clientSecret}`).toString(
				"base64",
			);
			tokenHeaders.Authorization = `Basic ${basic}`;
		} else {
			tokenBody.client_id = clientId;
			tokenBody.client_secret = clientSecret;
		}

		const tokenUrl = interpolate(template.oauth2.tokenUrl, {});
		const response = await fetch(tokenUrl, {
			method: "POST",
			headers: tokenHeaders,
			body: new URLSearchParams(tokenBody),
		});

		if (!response.ok) {
			// The body is deliberately not read: a token-endpoint error body can
			// echo the authorization code, a bearer/refresh token or the client
			// credentials we just sent, and this error is logged by the OAuth
			// callback handler. Only HTTP-level diagnostics travel with it.
			throw providerHttpError({
				operation: "OAuth token exchange",
				provider: template.id,
				response,
			});
		}

		// An unguarded parse would throw a SyntaxError quoting the body — the same
		// disclosure as the non-2xx body above. See provider-http-error.ts (#347).
		let data: Record<string, unknown>;
		try {
			data = (await response.json()) as Record<string, unknown>;
		} catch {
			throw providerJsonParseError({
				operation: "OAuth token exchange",
				provider: template.id,
				response,
			});
		}

		if (data.error) {
			// `error` and `error_description` are provider-supplied strings, so
			// neither is echoed verbatim. The code is fenced by enumeration
			// against RFC 6749 §5.2 / RFC 8628 §3.5; the free-text description is
			// dropped entirely.
			throw new Error(
				`OAuth token exchange failed for provider '${template.id}': provider returned error '${safeOAuthErrorCode(data.error)}' in a ${response.status} response`,
			);
		}

		// A 2xx with no usable access_token is not a success — without this guard
		// the credential is stored with `accessToken: undefined`. Whitespace-only
		// counts as absent.
		const accessToken = data.access_token;
		if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
			throw new Error("Token exchange response has no access_token");
		}

		const metadata: Record<string, unknown> = {};
		for (const path of template.oauth2.tokenResponseMetadata ?? []) {
			const value = getNestedValue(data, path);
			if (value !== undefined) {
				metadata[path.replace(/\./g, "_")] = value;
			}
		}

		const separator = template.oauth2.scopeSeparator ?? " ";

		return {
			accessToken,
			refreshToken: (data.refresh_token as string) ?? null,
			tokenType: (data.token_type as string) ?? "bearer",
			expiresIn: (data.expires_in as number) ?? null,
			grantedScopes: data.scope
				? (data.scope as string).split(separator)
				: undefined,
			metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
		};
	}
}

function getNestedValue(
	obj: Record<string, unknown>,
	path: string,
): unknown | undefined {
	const parts = path.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (current == null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}
