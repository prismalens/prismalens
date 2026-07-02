/**
 * Concurrent-safe token refresh with in-memory locking.
 * Uses a strategy pattern to support multiple auth modes (OAuth2, GitHub App, etc.).
 */
import type { AuthMode, AuthTemplate } from "../types.js";
import { GitHubAppFlow } from "./github-app-flow.js";
import { interpolate } from "./interpolate.js";
import type { TokenVault } from "./token-vault.js";

export interface RefreshableConnection {
	id: string;
	integrationId: string;
	credentialsEnc: Buffer;
	tokenExpiresAt: Date | null;
}

export interface RefreshDeps {
	getConnection(connectionId: string): Promise<RefreshableConnection | null>;
	getTemplate(integrationId: string): Promise<{
		template: AuthTemplate;
		clientId: string;
		clientSecret: string;
	} | null>;
	updateConnectionTokens(
		connectionId: string,
		data: {
			credentialsEnc: Buffer;
			tokenExpiresAt: Date | null;
			lastRefreshedAt: Date;
			status: string;
			consecutiveErrors: number;
		},
	): Promise<void>;
	markConnectionError(
		connectionId: string,
		error: string,
		status: string,
	): Promise<void>;
}

// =============================================================================
// REFRESH STRATEGY INTERFACE
// =============================================================================

interface RefreshStrategy {
	canRefresh(authMode: AuthMode): boolean;
	refresh(
		connection: RefreshableConnection,
		credentials: Record<string, unknown>,
		templateInfo: {
			template: AuthTemplate;
			clientId: string;
			clientSecret: string;
		},
		vault: TokenVault,
	): Promise<{
		accessToken: string;
		credentialsEnc: Buffer;
		tokenExpiresAt: Date | null;
	}>;
}

// =============================================================================
// OAUTH2 REFRESH STRATEGY
// =============================================================================

class OAuth2RefreshStrategy implements RefreshStrategy {
	canRefresh(authMode: AuthMode): boolean {
		return authMode === "oauth2";
	}

	async refresh(
		connection: RefreshableConnection,
		credentials: Record<string, unknown>,
		templateInfo: {
			template: AuthTemplate;
			clientId: string;
			clientSecret: string;
		},
		vault: TokenVault,
	) {
		const { template, clientId, clientSecret } = templateInfo;
		const refreshToken = credentials.refreshToken as string | undefined;

		if (!refreshToken) {
			throw new Error(
				`Connection ${connection.id} token expired but no refresh token available`,
			);
		}

		if (!template.oauth2) {
			throw new Error(`Template '${template.id}' has no oauth2 config`);
		}

		const refreshUrl = template.oauth2.refreshUrl ?? template.oauth2.tokenUrl;
		const tokenUrl = interpolate(refreshUrl, {});

		const body: Record<string, string> = {
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		};

		const headers: Record<string, string> = {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		};

		if (template.oauth2.tokenAuthMethod === "header") {
			headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
		} else {
			body.client_id = clientId;
			body.client_secret = clientSecret;
		}

		const response = await fetch(tokenUrl, {
			method: "POST",
			headers,
			body: new URLSearchParams(body),
			signal: AbortSignal.timeout(10_000),
		});

		if (!response.ok) {
			// Read body only to detect revocation; never expose raw body in errors
			const errorText = await response.text().catch(() => "");
			if (response.status === 400 && errorText.includes("invalid_grant")) {
				throw new Error("Refresh token revoked");
			}
			throw new Error(`Token refresh failed (HTTP ${response.status})`);
		}

		const data = (await response.json()) as Record<string, unknown>;

		const newAccessToken = data.access_token as string;
		const newRefreshToken = template.oauth2.rotatesRefreshToken
			? ((data.refresh_token as string) ?? refreshToken)
			: refreshToken;

		const newCredentials = {
			...credentials,
			accessToken: newAccessToken,
			refreshToken: newRefreshToken,
			tokenType: (data.token_type as string) ?? "bearer",
		};

		const expiresIn = data.expires_in as number | undefined;
		const tokenExpiresAt = expiresIn
			? new Date(Date.now() + expiresIn * 1000)
			: null;

		return {
			accessToken: newAccessToken,
			credentialsEnc: vault.encryptJSON(newCredentials),
			tokenExpiresAt,
		};
	}
}

// =============================================================================
// GITHUB APP REFRESH STRATEGY
// =============================================================================

class GitHubAppRefreshStrategy implements RefreshStrategy {
	canRefresh(authMode: AuthMode): boolean {
		return authMode === "github_app";
	}

	async refresh(
		connection: RefreshableConnection,
		credentials: Record<string, unknown>,
		templateInfo: {
			template: AuthTemplate;
			clientId: string;
			clientSecret: string;
		},
		vault: TokenVault,
	) {
		// For GitHub App, clientId stores appId and clientSecret stores JSON { privateKey, webhookSecret }
		const appId = templateInfo.clientId;
		let secretPayload: { privateKey: string; webhookSecret?: string };
		try {
			secretPayload = JSON.parse(templateInfo.clientSecret) as {
				privateKey: string;
				webhookSecret?: string;
			};
		} catch {
			// Fallback: raw PEM string (e.g., from seed script)
			secretPayload = { privateKey: templateInfo.clientSecret };
		}

		const installationId = credentials.installationId as string;
		if (!installationId) {
			throw new Error(
				`Connection ${connection.id}: missing installationId in credentials`,
			);
		}

		const jwt = GitHubAppFlow.generateJWT(appId, secretPayload.privateKey);

		// Use permission overrides if stored, otherwise use template defaults
		const permissionOverrides = credentials.permissionOverrides as
			| Record<string, string>
			| undefined;
		const permissions =
			permissionOverrides ??
			templateInfo.template.githubApp?.defaultPermissions;

		const tokenResult = await GitHubAppFlow.getInstallationToken(
			jwt,
			installationId,
			permissions,
		);

		const newCredentials = {
			...credentials,
			accessToken: tokenResult.token,
			installationToken: tokenResult.token,
			permissions: tokenResult.permissions,
			repositorySelection: tokenResult.repositorySelection,
		};

		return {
			accessToken: tokenResult.token,
			credentialsEnc: vault.encryptJSON(newCredentials),
			tokenExpiresAt: tokenResult.expiresAt,
		};
	}
}

// =============================================================================
// TOKEN REFRESHER
// =============================================================================

const STRATEGIES: RefreshStrategy[] = [
	new OAuth2RefreshStrategy(),
	new GitHubAppRefreshStrategy(),
];

export class TokenRefresher {
	private readonly refreshLocks = new Map<string, Promise<string>>();
	private readonly bufferSeconds: number;

	constructor(
		private readonly vault: TokenVault,
		private readonly deps: RefreshDeps,
		options?: { bufferSeconds?: number },
	) {
		this.bufferSeconds = options?.bufferSeconds ?? 300;
	}

	async getValidToken(connectionId: string): Promise<string> {
		const existingRefresh = this.refreshLocks.get(connectionId);
		if (existingRefresh) return existingRefresh;

		// Set lock immediately to prevent concurrent refresh attempts
		const refreshPromise = this.resolveOrRefresh(connectionId);
		this.refreshLocks.set(connectionId, refreshPromise);
		try {
			return await refreshPromise;
		} finally {
			this.refreshLocks.delete(connectionId);
		}
	}

	private async resolveOrRefresh(connectionId: string): Promise<string> {
		const connection = await this.deps.getConnection(connectionId);
		if (!connection) {
			throw new Error(`Connection ${connectionId} not found`);
		}

		const credentials = this.vault.decryptJSON<Record<string, unknown>>(
			connection.credentialsEnc,
		);

		const needsRefresh =
			connection.tokenExpiresAt &&
			connection.tokenExpiresAt.getTime() - this.bufferSeconds * 1000 <
				Date.now();

		if (!needsRefresh) {
			const token =
				(credentials.accessToken as string) ?? (credentials.apiKey as string);
			if (token) return token;
			throw new Error(`Connection ${connectionId} has no access token`);
		}

		return this.doRefresh(connection, credentials);
	}

	private async doRefresh(
		connection: RefreshableConnection,
		credentials: Record<string, unknown>,
	): Promise<string> {
		const templateInfo = await this.deps.getTemplate(connection.integrationId);
		if (!templateInfo) {
			throw new Error(
				`Template not found for integration ${connection.integrationId}`,
			);
		}

		const strategy = STRATEGIES.find((s) =>
			s.canRefresh(templateInfo.template.authMode),
		);
		if (!strategy) {
			throw new Error(
				`No refresh strategy for auth mode '${templateInfo.template.authMode}'`,
			);
		}

		try {
			const result = await strategy.refresh(
				connection,
				credentials,
				templateInfo,
				this.vault,
			);

			await this.deps.updateConnectionTokens(connection.id, {
				credentialsEnc: result.credentialsEnc,
				tokenExpiresAt: result.tokenExpiresAt,
				lastRefreshedAt: new Date(),
				status: "ACTIVE",
				consecutiveErrors: 0,
			});

			return result.accessToken;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown refresh error";

			const isRevoked =
				error instanceof Error && error.message.includes("revoked");
			const status = isRevoked ? "REVOKED" : "REFRESH_FAILED";

			await this.deps.markConnectionError(connection.id, errorMessage, status);
			throw error;
		}
	}
}
