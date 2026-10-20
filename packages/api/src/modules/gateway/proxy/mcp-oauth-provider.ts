// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Sign-in to a vendor MCP server (#848, 06): a per-install registration, tokens bound to the
 * issuer pinned at sign-in, and token requests only to the token endpoint pinned with it.
 */
import {
	type AuthProvider,
	auth,
	type FetchLike,
	type OAuthClientInformationContext,
	type OAuthClientMetadata,
	type OAuthClientProvider,
	type OAuthDiscoveryState,
	type StoredOAuthClientInformation,
	type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import type { SourceCredential } from "@prismalens/contracts/schemas";
import { withConnectionLock } from "@prismalens/integrations";
import type { UsedTokens } from "./upstream.js";

export type McpOAuthCredential = Extract<
	SourceCredential,
	{ kind: "mcp-oauth" }
>;

/** A client ID metadata document URL; empty until #865 publishes one. */
export const MCP_CLIENT_METADATA_URL = "";

export const NEEDS_SIGN_IN = "needs sign-in again";

export class NeedsSignInError extends Error {
	constructor() {
		super(NEEDS_SIGN_IN);
	}
}

export interface ProviderStore {
	current: McpOAuthCredential;
	save(next: McpOAuthCredential): Promise<void>;
}

export interface PendingSignIn {
	state: string;
	verifier?: string;
	/** Set by `redirectToAuthorization`: where to send the user. */
	authorizationUrl?: string;
	/** The connect form's override, else the 401 challenge's scope. */
	scopeOverride?: string;
	challengeScope?: string;
}

/**
 * The OAuthClientProvider. Interactive (with `pending`) during sign-in; without it, a
 * flow that needs the user throws `NeedsSignInError` instead of redirecting.
 */
export class McpOAuthProvider implements OAuthClientProvider {
	clientMetadataUrl = MCP_CLIENT_METADATA_URL || undefined;
	private discovery?: OAuthDiscoveryState;

	constructor(
		private readonly store: ProviderStore,
		private readonly pending?: PendingSignIn,
	) {}

	get redirectUrl(): string {
		return this.store.current.redirectUri;
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: "PrismaLens",
			redirect_uris: [this.store.current.redirectUri],
			grant_types: ["authorization_code", "refresh_token"],
			token_endpoint_auth_method: "none",
		};
	}

	state(): string {
		if (!this.pending) throw new NeedsSignInError();
		return this.pending.state;
	}

	private issuerMatches(ctx?: OAuthClientInformationContext): boolean {
		const pinned = this.store.current.issuer;
		return !ctx || !pinned || ctx.issuer === pinned;
	}

	clientInformation(
		ctx?: OAuthClientInformationContext,
	): StoredOAuthClientInformation | undefined {
		const c = this.store.current.client;
		if (!c || !this.issuerMatches(ctx)) return undefined;
		return {
			client_id: c.client_id,
			...(c.client_secret ? { client_secret: c.client_secret } : {}),
			...(this.store.current.issuer
				? { issuer: this.store.current.issuer }
				: {}),
		} as StoredOAuthClientInformation;
	}

	async saveClientInformation(
		info: StoredOAuthClientInformation,
	): Promise<void> {
		if (!this.pending) throw new NeedsSignInError();
		await this.write({
			client: {
				client_id: info.client_id,
				...(info.client_secret ? { client_secret: info.client_secret } : {}),
				registered: this.clientMetadataUrl ? "cimd" : "dcr",
			},
		});
	}

	tokens(ctx?: OAuthClientInformationContext): StoredOAuthTokens | undefined {
		const t = this.store.current.tokens;
		if (!t || !this.issuerMatches(ctx)) return undefined;
		return {
			access_token: t.access_token,
			token_type: "Bearer",
			...(this.store.current.issuer
				? { issuer: this.store.current.issuer }
				: {}),
			...(t.refresh_token ? { refresh_token: t.refresh_token } : {}),
			...(t.expires_at
				? {
						expires_in: Math.max(
							0,
							Math.floor((t.expires_at - Date.now()) / 1000),
						),
					}
				: {}),
		} as StoredOAuthTokens;
	}

	async saveTokens(
		t: StoredOAuthTokens,
		ctx?: OAuthClientInformationContext,
	): Promise<void> {
		const pinned = this.store.current;
		const tokenEndpoint =
			pinned.tokenEndpoint ??
			this.discovery?.authorizationServerMetadata?.token_endpoint;
		await this.write({
			...(!pinned.issuer && ctx?.issuer ? { issuer: ctx.issuer } : {}),
			...(!pinned.tokenEndpoint && tokenEndpoint ? { tokenEndpoint } : {}),
			tokens: {
				access_token: t.access_token,
				...(t.refresh_token
					? { refresh_token: t.refresh_token }
					: pinned.tokens?.refresh_token
						? { refresh_token: pinned.tokens.refresh_token }
						: {}),
				...(t.expires_in
					? { expires_at: Date.now() + t.expires_in * 1000 }
					: {}),
			},
		});
	}

	saveDiscoveryState(state: OAuthDiscoveryState): void {
		this.discovery = state;
	}

	discoveryState(): OAuthDiscoveryState | undefined {
		return this.discovery;
	}

	/** The server decides the scope; PrismaLens sends no catalogue (06). */
	async redirectToAuthorization(url: URL): Promise<void> {
		if (!this.pending) throw new NeedsSignInError();
		let scope = this.pending.scopeOverride ?? this.pending.challengeScope;
		const supported =
			this.discovery?.authorizationServerMetadata?.scopes_supported ?? [];
		if (supported.includes("offline_access"))
			scope = [scope, "offline_access"].filter(Boolean).join(" ");
		if (scope) url.searchParams.set("scope", scope);
		else url.searchParams.delete("scope");
		if (scope) await this.write({ scope });
		this.pending.authorizationUrl = url.href;
	}

	saveCodeVerifier(v: string): void {
		if (this.pending) this.pending.verifier = v;
	}

	codeVerifier(): string {
		if (!this.pending?.verifier) throw new NeedsSignInError();
		return this.pending.verifier;
	}

	private async write(patch: Partial<McpOAuthCredential>): Promise<void> {
		const next = { ...this.store.current, ...patch };
		await this.store.save(next);
		this.store.current = next;
	}
}

/**
 * `auth()`'s fetch (OBJ-016): https only, no redirects, discovery to the server and the
 * pinned issuer, and a token request only to the exact pinned token endpoint.
 */
export function authFetch(
	cred: () => McpOAuthCredential,
	opts: { signIn?: boolean; fetch?: typeof fetch } = {},
): FetchLike {
	const base = opts.fetch ?? fetch;
	return async (input, init) => {
		const url = new URL(String(input instanceof Request ? input.url : input));
		const c = cred();
		if (url.protocol !== "https:") throw new NeedsSignInError();
		const body =
			typeof init?.body === "string"
				? init.body
				: init?.body instanceof URLSearchParams
					? init.body.toString()
					: "";
		const isToken = /(^|&)grant_type=/.test(body);
		const server = new URL(c.serverUrl).origin;
		const issuer = c.issuer ? new URL(c.issuer).origin : null;
		const ok = isToken
			? c.tokenEndpoint
				? url.href === c.tokenEndpoint
				: !!opts.signIn
			: opts.signIn || url.origin === server || url.origin === issuer;
		if (!ok) throw new NeedsSignInError();
		const res = await base(url.href, { ...init, redirect: "manual" });
		if (res.status >= 300 && res.status < 400) {
			await res.body?.cancel();
			throw new NeedsSignInError();
		}
		return res;
	};
}

/**
 * The transport's AuthProvider: one lock spans every client in every run, and a refresh
 * runs only when the token that failed is still the stored one (OBJ-007).
 */
export function lockedAuthProvider(p: {
	connectionId: string;
	load(): Promise<McpOAuthCredential>;
	save(next: McpOAuthCredential): Promise<void>;
	usedToken: UsedTokens;
	fetch?: typeof fetch;
	onNeedsSignIn?(): Promise<void>;
}): AuthProvider {
	return {
		token: async () => (await p.load()).tokens?.access_token,
		onUnauthorized: (ctx) =>
			withConnectionLock(p.connectionId, async () => {
				const current = await p.load();
				const used = p.usedToken.get(ctx.response);
				if (!used || current.tokens?.access_token !== used) return;
				const store: ProviderStore = { current, save: p.save };
				try {
					const r = await auth(new McpOAuthProvider(store), {
						serverUrl: current.serverUrl,
						fetchFn: authFetch(() => store.current, { fetch: p.fetch }),
					});
					if (r !== "AUTHORIZED") throw new NeedsSignInError();
				} catch (e) {
					await p.onNeedsSignIn?.();
					throw e instanceof NeedsSignInError ? e : new NeedsSignInError();
				}
			}),
	};
}
