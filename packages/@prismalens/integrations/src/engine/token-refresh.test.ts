// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Token refresh (#253): the OAuth2 and GitHub-App refresh strategies plus the
 * per-connection refresh lock. The race tests fire genuinely concurrent
 * getValidToken() calls with Promise.all — N callers must collapse to ONE
 * provider round-trip and ONE stored credential, with no lost update and no
 * caller left holding a stale token. Hermetic — fetch stubbed, vault in-memory.
 */
import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthTemplate } from "../types.js";
import {
	type RefreshableConnection,
	type RefreshDeps,
	TokenRefresher,
} from "./token-refresh.js";
import { TokenVault } from "./token-vault.js";

const VAULT = new TokenVault(Buffer.alloc(32, 0x33));

const { privateKey: RSA_PRIVATE_KEY } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	publicKeyEncoding: { type: "spki", format: "pem" },
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

type OAuth2Config = NonNullable<AuthTemplate["oauth2"]>;

const OAUTH2_CONFIG: OAuth2Config = {
	authorizationUrl: "https://acme.test/oauth/authorize",
	tokenUrl: "https://acme.test/oauth/token",
	tokenAuthMethod: "body",
};

const OAUTH_TEMPLATE: AuthTemplate = {
	id: "acme",
	name: "Acme",
	version: "1.0.0",
	category: "vcs",
	authMode: "oauth2",
	oauth2: OAUTH2_CONFIG,
	authenticate: {},
	proxy: { baseUrl: "https://api.acme.test" },
	connectionCreation: { mode: "oauth_redirect" },
	postIntegrationCreation: { action: "oauth_redirect" },
	display: { authModeLabel: "OAuth2" },
};

const GITHUB_APP_TEMPLATE: AuthTemplate = {
	...OAUTH_TEMPLATE,
	id: "github-app",
	name: "GitHub (App)",
	authMode: "github_app",
	oauth2: undefined,
	githubApp: { defaultPermissions: { contents: "read" } },
};

const API_KEY_TEMPLATE: AuthTemplate = {
	...OAUTH_TEMPLATE,
	id: "static",
	name: "Static",
	authMode: "api_key",
	oauth2: undefined,
};

interface TemplateInfo {
	template: AuthTemplate;
	clientId: string;
	clientSecret: string;
}

/** An oauth2 TemplateInfo with the given oauth2 overrides applied. */
function oauthTemplateInfo(overrides: Partial<OAuth2Config>): TemplateInfo {
	return {
		template: { ...OAUTH_TEMPLATE, oauth2: { ...OAUTH2_CONFIG, ...overrides } },
		clientId: "client-abc",
		clientSecret: "secret-xyz",
	};
}

class MemoryRefreshDeps implements RefreshDeps {
	readonly connections = new Map<string, RefreshableConnection>();
	readonly templates = new Map<string, TemplateInfo>();
	readonly updates: Array<{
		connectionId: string;
		credentials: Record<string, unknown>;
		tokenExpiresAt: Date | null;
		status: string;
		consecutiveErrors: number;
	}> = [];
	readonly errors: Array<{
		connectionId: string;
		error: string;
		status: string;
	}> = [];

	async getConnection(
		connectionId: string,
	): Promise<RefreshableConnection | null> {
		return this.connections.get(connectionId) ?? null;
	}

	async getTemplate(integrationId: string): Promise<TemplateInfo | null> {
		return this.templates.get(integrationId) ?? null;
	}

	async updateConnectionTokens(
		connectionId: string,
		data: {
			credentialsEnc: Buffer;
			tokenExpiresAt: Date | null;
			lastRefreshedAt: Date;
			status: string;
			consecutiveErrors: number;
		},
	): Promise<void> {
		const connection = this.connections.get(connectionId);
		if (connection) {
			connection.credentialsEnc = data.credentialsEnc;
			connection.tokenExpiresAt = data.tokenExpiresAt;
		}
		this.updates.push({
			connectionId,
			credentials: VAULT.decryptJSON(data.credentialsEnc),
			tokenExpiresAt: data.tokenExpiresAt,
			status: data.status,
			consecutiveErrors: data.consecutiveErrors,
		});
	}

	async markConnectionError(
		connectionId: string,
		error: string,
		status: string,
	): Promise<void> {
		this.errors.push({ connectionId, error, status });
	}
}

function resolveExpiry(expiresInMs: number | null | undefined): Date | null {
	if (expiresInMs === null) return null;
	if (expiresInMs === undefined) return new Date(Date.now() - 1000);
	return new Date(Date.now() + expiresInMs);
}

function seed(
	deps: MemoryRefreshDeps,
	options: {
		connectionId?: string;
		integrationId?: string;
		credentials?: Record<string, unknown>;
		expiresInMs?: number | null;
		templateInfo?: TemplateInfo;
	} = {},
): RefreshableConnection {
	const connectionId = options.connectionId ?? "conn_1";
	const integrationId = options.integrationId ?? "int_1";
	const connection: RefreshableConnection = {
		id: connectionId,
		integrationId,
		credentialsEnc: VAULT.encryptJSON(
			options.credentials ?? {
				accessToken: "at_old",
				refreshToken: "rt_old",
			},
		),
		// Default: already expired, so the connection needs a refresh.
		// `null` means "no expiry recorded" (static credentials).
		tokenExpiresAt: resolveExpiry(options.expiresInMs),
	};
	deps.connections.set(connectionId, connection);
	deps.templates.set(
		integrationId,
		options.templateInfo ?? {
			template: OAUTH_TEMPLATE,
			clientId: "client-abc",
			clientSecret: "secret-xyz",
		},
	);
	return connection;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/** A response that only settles after `ticks` microtask/macrotask turns. */
function delayed(response: Response, ms = 10): Promise<Response> {
	return new Promise((resolve) => setTimeout(() => resolve(response), ms));
}

describe("TokenRefresher — token resolution without refresh", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns the stored access token when it is still valid", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps, { expiresInMs: 3_600_000 });
		const refresher = new TokenRefresher(VAULT, deps);

		await expect(refresher.getValidToken("conn_1")).resolves.toBe("at_old");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns a static apiKey credential when there is no expiry", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps, {
			credentials: { apiKey: "sk_static" },
			expiresInMs: null,
			templateInfo: {
				template: API_KEY_TEMPLATE,
				clientId: "",
				clientSecret: "",
			},
		});
		const refresher = new TokenRefresher(VAULT, deps);

		await expect(refresher.getValidToken("conn_1")).resolves.toBe("sk_static");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("refreshes once the token enters the expiry buffer", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps, { expiresInMs: 60_000 }); // inside the default 300s buffer
		fetchMock.mockResolvedValue(jsonResponse({ access_token: "at_new" }));
		const refresher = new TokenRefresher(VAULT, deps);

		await expect(refresher.getValidToken("conn_1")).resolves.toBe("at_new");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("honours a custom buffer", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps, { expiresInMs: 60_000 });
		const refresher = new TokenRefresher(VAULT, deps, { bufferSeconds: 30 });

		await expect(refresher.getValidToken("conn_1")).resolves.toBe("at_old");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("throws when the connection does not exist", async () => {
		const refresher = new TokenRefresher(VAULT, new MemoryRefreshDeps());
		await expect(refresher.getValidToken("missing")).rejects.toThrow(
			"Connection missing not found",
		);
	});

	it("throws when a valid connection carries no usable token", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps, { credentials: { username: "bob" }, expiresInMs: 3_600_000 });
		const refresher = new TokenRefresher(VAULT, deps);

		await expect(refresher.getValidToken("conn_1")).rejects.toThrow(
			"Connection conn_1 has no access token",
		);
	});

	it("throws when the integration template is missing", async () => {
		const deps = new MemoryRefreshDeps();
		const connection = seed(deps);
		deps.templates.delete(connection.integrationId);
		const refresher = new TokenRefresher(VAULT, deps);

		await expect(refresher.getValidToken("conn_1")).rejects.toThrow(
			"Template not found for integration int_1",
		);
	});

	it("throws when no strategy handles the auth mode", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps, {
			templateInfo: {
				template: API_KEY_TEMPLATE,
				clientId: "",
				clientSecret: "",
			},
		});
		const refresher = new TokenRefresher(VAULT, deps);

		await expect(refresher.getValidToken("conn_1")).rejects.toThrow(
			"No refresh strategy for auth mode 'api_key'",
		);
	});
});

describe("TokenRefresher — OAuth2 refresh strategy", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("exchanges the refresh token and re-encrypts the new credentials", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps);
		fetchMock.mockResolvedValue(
			jsonResponse({
				access_token: "at_new",
				token_type: "Bearer",
				expires_in: 3600,
			}),
		);
		const refresher = new TokenRefresher(VAULT, deps);

		const token = await refresher.getValidToken("conn_1");

		expect(token).toBe("at_new");
		expect(deps.updates).toHaveLength(1);
		expect(deps.updates[0].credentials).toEqual({
			accessToken: "at_new",
			refreshToken: "rt_old",
			tokenType: "Bearer",
		});
		expect(deps.updates[0].status).toBe("ACTIVE");
		expect(deps.updates[0].consecutiveErrors).toBe(0);
		expect(deps.updates[0].tokenExpiresAt).toBeInstanceOf(Date);
		expect(deps.errors).toHaveLength(0);

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = new URLSearchParams(init.body as unknown as string);
		expect(body.get("grant_type")).toBe("refresh_token");
		expect(body.get("refresh_token")).toBe("rt_old");
		expect(body.get("client_id")).toBe("client-abc");
		expect(body.get("client_secret")).toBe("secret-xyz");
	});

	it("stores the credential encrypted — the new token is never persisted in the clear", async () => {
		const deps = new MemoryRefreshDeps();
		const connection = seed(deps);
		fetchMock.mockResolvedValue(jsonResponse({ access_token: "at_new_secret" }));
		const refresher = new TokenRefresher(VAULT, deps);

		await refresher.getValidToken("conn_1");

		expect(
			connection.credentialsEnc.includes(Buffer.from("at_new_secret")),
		).toBe(false);
		expect(
			VAULT.decryptJSON<{ accessToken: string }>(connection.credentialsEnc)
				.accessToken,
		).toBe("at_new_secret");
	});

	it("uses the refreshUrl when the template declares one", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps, {
			templateInfo: oauthTemplateInfo({
				refreshUrl: "https://acme.test/oauth/refresh",
			}),
		});
		fetchMock.mockResolvedValue(jsonResponse({ access_token: "at_new" }));

		await new TokenRefresher(VAULT, deps).getValidToken("conn_1");

		expect(fetchMock.mock.calls[0][0]).toBe("https://acme.test/oauth/refresh");
	});

	it("sends client credentials via Basic auth when configured", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps, {
			templateInfo: oauthTemplateInfo({ tokenAuthMethod: "header" }),
		});
		fetchMock.mockResolvedValue(jsonResponse({ access_token: "at_new" }));

		await new TokenRefresher(VAULT, deps).getValidToken("conn_1");

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>).Authorization).toBe(
			`Basic ${Buffer.from("client-abc:secret-xyz").toString("base64")}`,
		);
		expect(
			new URLSearchParams(init.body as unknown as string).get("client_secret"),
		).toBeNull();
	});

	it("ignores a rotated refresh token when the template does not declare rotation", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps);
		fetchMock.mockResolvedValue(
			jsonResponse({ access_token: "at_new", refresh_token: "rt_rotated" }),
		);

		await new TokenRefresher(VAULT, deps).getValidToken("conn_1");

		expect(deps.updates[0].credentials.refreshToken).toBe("rt_old");
	});

	it("adopts the rotated refresh token when the template rotates", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps, {
			templateInfo: oauthTemplateInfo({ rotatesRefreshToken: true }),
		});
		fetchMock.mockResolvedValue(
			jsonResponse({ access_token: "at_new", refresh_token: "rt_rotated" }),
		);

		await new TokenRefresher(VAULT, deps).getValidToken("conn_1");

		expect(deps.updates[0].credentials.refreshToken).toBe("rt_rotated");
	});

	it("falls back to the old refresh token when a rotating provider omits it", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps, {
			templateInfo: oauthTemplateInfo({ rotatesRefreshToken: true }),
		});
		fetchMock.mockResolvedValue(jsonResponse({ access_token: "at_new" }));

		await new TokenRefresher(VAULT, deps).getValidToken("conn_1");

		expect(deps.updates[0].credentials.refreshToken).toBe("rt_old");
	});

	it("refuses to refresh a connection with no refresh token", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps, { credentials: { accessToken: "at_old" } });
		const refresher = new TokenRefresher(VAULT, deps);

		await expect(refresher.getValidToken("conn_1")).rejects.toThrow(
			"token expired but no refresh token available",
		);
		expect(deps.errors[0]?.status).toBe("REFRESH_FAILED");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("marks the connection REVOKED on invalid_grant", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps);
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
		);
		const refresher = new TokenRefresher(VAULT, deps);

		await expect(refresher.getValidToken("conn_1")).rejects.toThrow(
			"Refresh token revoked",
		);
		expect(deps.errors).toEqual([
			{
				connectionId: "conn_1",
				error: "Refresh token revoked",
				status: "REVOKED",
			},
		]);
		expect(deps.updates).toHaveLength(0);
	});

	it("marks REFRESH_FAILED on a server error without leaking the body", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps);
		fetchMock.mockResolvedValue(
			new Response("client_secret=secret-xyz is invalid", { status: 500 }),
		);
		const refresher = new TokenRefresher(VAULT, deps);

		await expect(refresher.getValidToken("conn_1")).rejects.toThrow(
			"Token refresh failed (HTTP 500)",
		);
		expect(deps.errors[0].status).toBe("REFRESH_FAILED");
		expect(deps.errors[0].error).not.toContain("secret-xyz");
		expect(deps.updates).toHaveLength(0);
	});

	it("throws rather than storing a credential with no access token", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps);
		fetchMock.mockResolvedValue(jsonResponse({ token_type: "bearer" }));
		const refresher = new TokenRefresher(VAULT, deps);

		await expect(refresher.getValidToken("conn_1")).rejects.toThrow(
			/access_token/,
		);
		expect(deps.updates).toHaveLength(0);
		expect(deps.errors[0].status).toBe("REFRESH_FAILED");
	});
});

describe("TokenRefresher — GitHub App refresh strategy", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function seedGitHubApp(
		deps: MemoryRefreshDeps,
		clientSecret: string,
		credentials: Record<string, unknown> = { installationId: "42" },
	) {
		return seed(deps, {
			credentials,
			templateInfo: {
				template: GITHUB_APP_TEMPLATE,
				clientId: "123456",
				clientSecret,
			},
		});
	}

	it("mints a JWT and swaps it for an installation token", async () => {
		const deps = new MemoryRefreshDeps();
		seedGitHubApp(deps, JSON.stringify({ privateKey: RSA_PRIVATE_KEY }));
		const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
		fetchMock.mockResolvedValue(
			jsonResponse({
				token: "ghs_new",
				expires_at: expiresAt,
				permissions: { contents: "read" },
				repository_selection: "selected",
			}),
		);

		const token = await new TokenRefresher(VAULT, deps).getValidToken("conn_1");

		expect(token).toBe("ghs_new");
		expect(deps.updates[0].credentials).toMatchObject({
			accessToken: "ghs_new",
			installationToken: "ghs_new",
			installationId: "42",
			permissions: { contents: "read" },
			repositorySelection: "selected",
		});
		expect(deps.updates[0].tokenExpiresAt?.toISOString()).toBe(expiresAt);

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(
			"https://api.github.com/app/installations/42/access_tokens",
		);
		const authorization = (init.headers as Record<string, string>).Authorization;
		expect(authorization.startsWith("Bearer ")).toBe(true);
		const jwt = authorization.slice("Bearer ".length);
		const header = JSON.parse(
			Buffer.from(jwt.split(".")[0], "base64url").toString("utf8"),
		);
		expect(header.alg).toBe("RS256");
	});

	it("accepts a raw PEM client secret as well as the JSON envelope", async () => {
		const deps = new MemoryRefreshDeps();
		seedGitHubApp(deps, RSA_PRIVATE_KEY);
		fetchMock.mockResolvedValue(
			jsonResponse({
				token: "ghs_new",
				expires_at: new Date(Date.now() + 3_600_000).toISOString(),
				permissions: {},
				repository_selection: "all",
			}),
		);

		await expect(
			new TokenRefresher(VAULT, deps).getValidToken("conn_1"),
		).resolves.toBe("ghs_new");
	});

	it("prefers stored permission overrides over the template defaults", async () => {
		const deps = new MemoryRefreshDeps();
		seedGitHubApp(deps, RSA_PRIVATE_KEY, {
			installationId: "42",
			permissionOverrides: { issues: "write" },
		});
		fetchMock.mockResolvedValue(
			jsonResponse({
				token: "ghs_new",
				expires_at: new Date(Date.now() + 3_600_000).toISOString(),
				permissions: { issues: "write" },
				repository_selection: "all",
			}),
		);

		await new TokenRefresher(VAULT, deps).getValidToken("conn_1");

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(JSON.parse(init.body as string)).toEqual({
			permissions: { issues: "write" },
		});
	});

	it("fails when the credential has no installationId", async () => {
		const deps = new MemoryRefreshDeps();
		seedGitHubApp(deps, RSA_PRIVATE_KEY, { accessToken: "at_old" });

		await expect(
			new TokenRefresher(VAULT, deps).getValidToken("conn_1"),
		).rejects.toThrow("missing installationId in credentials");
		expect(deps.errors[0].status).toBe("REFRESH_FAILED");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("TokenRefresher — concurrent refresh (the #253 race falsifier)", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("collapses N concurrent refreshes into one exchange and one stored credential", async () => {
		const deps = new MemoryRefreshDeps();
		const connection = seed(deps);
		let issued = 0;
		fetchMock.mockImplementation(() => {
			issued += 1;
			return delayed(
				jsonResponse({ access_token: `at_new_${issued}`, expires_in: 3600 }),
			);
		});
		const refresher = new TokenRefresher(VAULT, deps);

		const tokens = await Promise.all([
			refresher.getValidToken("conn_1"),
			refresher.getValidToken("conn_1"),
			refresher.getValidToken("conn_1"),
			refresher.getValidToken("conn_1"),
			refresher.getValidToken("conn_1"),
		]);

		// One provider round-trip, one write, and every caller holds the SAME token.
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(deps.updates).toHaveLength(1);
		expect(new Set(tokens).size).toBe(1);
		expect(tokens[0]).toBe("at_new_1");
		// No lost update: what is persisted is exactly what the callers received.
		expect(
			VAULT.decryptJSON<{ accessToken: string }>(connection.credentialsEnc)
				.accessToken,
		).toBe(tokens[0]);
	});

	it("keeps refreshes for different connections independent", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps, { connectionId: "conn_a", integrationId: "int_a" });
		seed(deps, { connectionId: "conn_b", integrationId: "int_b" });
		let issued = 0;
		fetchMock.mockImplementation(() => {
			issued += 1;
			return delayed(jsonResponse({ access_token: `at_new_${issued}` }));
		});
		const refresher = new TokenRefresher(VAULT, deps);

		const [a, b] = await Promise.all([
			refresher.getValidToken("conn_a"),
			refresher.getValidToken("conn_b"),
		]);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(deps.updates).toHaveLength(2);
		expect(a).not.toBe(b);
		expect(new Set(deps.updates.map((u) => u.connectionId)).size).toBe(2);
	});

	it("releases the lock so a later expiry refreshes again", async () => {
		const deps = new MemoryRefreshDeps();
		const connection = seed(deps);
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ access_token: "at_first" }))
			.mockResolvedValueOnce(jsonResponse({ access_token: "at_second" }));
		const refresher = new TokenRefresher(VAULT, deps);

		await Promise.all([
			refresher.getValidToken("conn_1"),
			refresher.getValidToken("conn_1"),
		]);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// The provider returned no expires_in, so the connection is expiry-less and
		// resolves from cache; force it back into the buffer to prove the lock is gone.
		connection.tokenExpiresAt = new Date(Date.now() - 1000);
		await expect(refresher.getValidToken("conn_1")).resolves.toBe("at_second");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("serves the refreshed token from cache to callers arriving after it settles", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps);
		// A fresh Response per call, so a second fetch shows up as a call-count
		// failure rather than a consumed-body error.
		fetchMock.mockImplementation(() =>
			jsonResponse({ access_token: "at_new", expires_in: 3600 }),
		);
		const refresher = new TokenRefresher(VAULT, deps);

		const first = await refresher.getValidToken("conn_1");
		const second = await refresher.getValidToken("conn_1");

		expect(first).toBe("at_new");
		expect(second).toBe("at_new");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(deps.updates).toHaveLength(1);
	});

	it("fails every concurrent caller once, then allows a retry", async () => {
		const deps = new MemoryRefreshDeps();
		seed(deps);
		fetchMock.mockImplementationOnce(() =>
			delayed(new Response("boom", { status: 500 })),
		);
		const refresher = new TokenRefresher(VAULT, deps);

		const settled = await Promise.allSettled([
			refresher.getValidToken("conn_1"),
			refresher.getValidToken("conn_1"),
			refresher.getValidToken("conn_1"),
		]);

		expect(settled.every((r) => r.status === "rejected")).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		// One failed refresh, one error record — not one per caller.
		expect(deps.errors).toHaveLength(1);
		expect(deps.errors[0].status).toBe("REFRESH_FAILED");

		// Lock released: a retry reaches the provider again.
		fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "at_new" }));
		await expect(refresher.getValidToken("conn_1")).resolves.toBe("at_new");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
