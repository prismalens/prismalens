/**
 * Concurrent-safe token refresh with in-memory locking.
 * Prevents multiple simultaneous refreshes for the same connection.
 */
import type { AuthTemplate } from "../types.js";
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

		const connection = await this.deps.getConnection(connectionId);
		if (!connection) {
			throw new Error(`Connection ${connectionId} not found`);
		}

		const credentials = this.vault.decryptJSON<{
			accessToken: string;
			refreshToken?: string;
		}>(connection.credentialsEnc);

		const needsRefresh =
			connection.tokenExpiresAt &&
			connection.tokenExpiresAt.getTime() - this.bufferSeconds * 1000 <
				Date.now();

		if (!needsRefresh) {
			return credentials.accessToken;
		}

		if (!credentials.refreshToken) {
			throw new Error(
				`Connection ${connectionId} token expired but no refresh token available`,
			);
		}

		const refreshPromise = this.doRefresh(connection, credentials.refreshToken);
		this.refreshLocks.set(connectionId, refreshPromise);
		try {
			return await refreshPromise;
		} finally {
			this.refreshLocks.delete(connectionId);
		}
	}

	private async doRefresh(
		connection: RefreshableConnection,
		refreshToken: string,
	): Promise<string> {
		const templateInfo = await this.deps.getTemplate(connection.integrationId);
		if (!templateInfo) {
			throw new Error(
				`Template not found for integration ${connection.integrationId}`,
			);
		}

		const { template, clientId, clientSecret } = templateInfo;
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

		try {
			const response = await fetch(tokenUrl, {
				method: "POST",
				headers,
				body: new URLSearchParams(body),
			});

			if (!response.ok) {
				const errorText = await response.text();

				if (
					response.status === 400 &&
					errorText.includes("invalid_grant")
				) {
					await this.deps.markConnectionError(
						connection.id,
						"Refresh token revoked or expired",
						"REVOKED",
					);
					throw new Error("Refresh token revoked");
				}

				await this.deps.markConnectionError(
					connection.id,
					`Refresh failed: ${response.status}`,
					"REFRESH_FAILED",
				);
				throw new Error(`Token refresh failed: ${response.status}`);
			}

			const data = (await response.json()) as Record<string, unknown>;

			const newAccessToken = data.access_token as string;
			const newRefreshToken = template.oauth2.rotatesRefreshToken
				? ((data.refresh_token as string) ?? refreshToken)
				: refreshToken;

			const newCredentials = {
				accessToken: newAccessToken,
				refreshToken: newRefreshToken,
				tokenType: (data.token_type as string) ?? "bearer",
			};

			const expiresIn = data.expires_in as number | undefined;
			const tokenExpiresAt = expiresIn
				? new Date(Date.now() + expiresIn * 1000)
				: null;

			await this.deps.updateConnectionTokens(connection.id, {
				credentialsEnc: this.vault.encryptJSON(newCredentials),
				tokenExpiresAt,
				lastRefreshedAt: new Date(),
				status: "ACTIVE",
				consecutiveErrors: 0,
			});

			return newAccessToken;
		} catch (error) {
			if (
				error instanceof Error &&
				(error.message.includes("revoked") ||
					error.message.includes("Refresh failed"))
			) {
				throw error;
			}

			const errorMessage =
				error instanceof Error ? error.message : "Unknown refresh error";
			await this.deps.markConnectionError(
				connection.id,
				errorMessage,
				"REFRESH_FAILED",
			);
			throw error;
		}
	}
}
