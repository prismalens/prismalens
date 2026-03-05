/**
 * Template-driven OAuth2 authorization flow with PKCE support.
 * DB-backed state via injected interface — no NestJS dependency.
 */
import { createHash, randomBytes } from "crypto";
import type { AuthTemplate, OAuthStateData, TokenResult } from "../types.js";
import { interpolate } from "./interpolate.js";
import type { TokenVault } from "./token-vault.js";

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
		const { template, integrationId, userId, organizationId, clientId, callbackUrl, scopes, connectionConfig } = params;

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

	async handleCallback(
		code: string,
		stateToken: string,
		getClientCredentials: (integrationId: string) => Promise<{ clientId: string; clientSecret: string }>,
	): Promise<{
		tokenResult: TokenResult;
		oauthState: OAuthStateData;
	}> {
		const oauthState = await this.deps.getOAuthState(stateToken);
		if (!oauthState) {
			throw new Error("Invalid OAuth state — possible CSRF attack");
		}
		if (oauthState.expiresAt < new Date()) {
			await this.deps.deleteOAuthState(stateToken);
			throw new Error("OAuth state expired");
		}
		await this.deps.deleteOAuthState(stateToken);

		const { clientId, clientSecret } = await getClientCredentials(
			oauthState.integrationId,
		);

		return {
			tokenResult: await this.exchangeCode(
				code,
				oauthState,
				clientId,
				clientSecret,
			),
			oauthState,
		};
	}

	private async exchangeCode(
		code: string,
		oauthState: OAuthStateData,
		clientId: string,
		clientSecret: string,
	): Promise<TokenResult> {
		// The template is looked up by the caller — we receive it indirectly
		// For now, we do a generic token exchange. Template-specific params
		// are handled by the NestJS adapter layer.
		const tokenBody: Record<string, string> = {
			grant_type: "authorization_code",
			code,
			redirect_uri: oauthState.callbackUrl,
			client_id: clientId,
			client_secret: clientSecret,
		};

		if (oauthState.codeVerifier) {
			tokenBody.code_verifier = oauthState.codeVerifier;
		}

		return { tokenBody } as unknown as TokenResult;
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
			const errorText = await response.text();
			throw new Error(`Token exchange failed (${response.status}): ${errorText}`);
		}

		const data = (await response.json()) as Record<string, unknown>;

		if (data.error) {
			throw new Error(
				`OAuth error: ${data.error_description ?? data.error}`,
			);
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
			accessToken: data.access_token as string,
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
