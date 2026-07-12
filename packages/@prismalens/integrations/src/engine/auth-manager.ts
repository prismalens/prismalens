// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * AuthManager — facade for credential resolution across all auth modes.
 * Wraps TokenRefresher for token lifecycle, provides getAuthHeaders(),
 * request(), and verifyConnection() for consumers.
 */
import type { AuthTemplate } from "../types.js";
import {
	CredentialsInvalidError,
	ProviderError,
	RateLimitError,
} from "./errors.js";
import { interpolate, interpolateRecord } from "./interpolate.js";
import type { RefreshDeps } from "./token-refresh.js";
import { TokenRefresher } from "./token-refresh.js";
import type { TokenVault } from "./token-vault.js";

export interface AuthManagerDeps extends RefreshDeps {
	getTemplateForConnection(connectionId: string): Promise<AuthTemplate | null>;
	getConnectionCredentials(
		connectionId: string,
	): Promise<Record<string, unknown> | null>;
}

export class AuthManager {
	private readonly refresher: TokenRefresher;

	constructor(
		vault: TokenVault,
		private readonly deps: AuthManagerDeps,
		options?: { bufferSeconds?: number },
	) {
		this.refresher = new TokenRefresher(vault, deps, options);
	}

	/**
	 * Resolve a valid access token for any auth mode.
	 * Handles on-demand refresh for OAuth2 and GitHub App tokens.
	 * Returns the plain access token / API key string.
	 */
	async resolveAccessToken(connectionId: string): Promise<string> {
		return this.refresher.getValidToken(connectionId);
	}

	/**
	 * Build the interpolation context from credentials + resolved token.
	 * Merges template field defaults (lowest priority) → stored credentials → token (highest).
	 */
	private async buildContext(
		connectionId: string,
		token: string,
		template?: AuthTemplate | null,
	): Promise<Record<string, string>> {
		const credentials = await this.deps.getConnectionCredentials(connectionId);

		// Collect default values from template fields (fallback for missing credentials)
		const defaults: Record<string, string> = {};
		if (template) {
			for (const field of template.connectionCredentialFields ?? []) {
				if (field.default && typeof field.default === "string") {
					defaults[field.name] = field.default;
				}
			}
			for (const field of template.integrationCredentialFields ?? []) {
				if (field.default && typeof field.default === "string") {
					defaults[field.name] = field.default;
				}
			}
		}

		return {
			...defaults,
			...(credentials
				? Object.fromEntries(
						Object.entries(credentials).filter(
							([, v]) => typeof v === "string",
						),
					)
				: {}),
			accessToken: token,
			installationToken: token,
			apiKey: token,
		};
	}

	/**
	 * Get fully interpolated auth headers for a connection.
	 * Resolves the token first, then applies template.authenticate.headers.
	 */
	async getAuthHeaders(connectionId: string): Promise<Record<string, string>> {
		const token = await this.resolveAccessToken(connectionId);

		const template = await this.deps.getTemplateForConnection(connectionId);
		if (!template?.authenticate?.headers) {
			return { Authorization: `Bearer ${token}` };
		}

		const context = await this.buildContext(connectionId, token, template);
		return interpolateRecord(template.authenticate.headers, context);
	}

	/**
	 * Make an authenticated request through the template's proxy config.
	 * Resolves credentials, interpolates headers, prepends baseUrl.
	 * Retries once on 401 after refreshing the token.
	 */
	async request(
		connectionId: string,
		method: string,
		path: string,
		options?: {
			body?: string;
			headers?: Record<string, string>;
			timeoutMs?: number;
		},
	): Promise<Response> {
		const template = await this.deps.getTemplateForConnection(connectionId);

		const doRequest = async (isRetry: boolean): Promise<Response> => {
			const token = isRetry
				? await this.refresher.getValidToken(connectionId)
				: await this.resolveAccessToken(connectionId);
			const context = await this.buildContext(connectionId, token, template);

			// Build URL from proxy.baseUrl + path
			let baseUrl = template?.proxy?.baseUrl ?? "";
			if (baseUrl.includes("{{")) {
				baseUrl = interpolate(baseUrl, context);
			}
			const url = `${baseUrl}${path}`;

			// Build headers: proxy defaults + authenticate headers + caller overrides
			const headers: Record<string, string> = {};
			if (template?.proxy?.headers) {
				Object.assign(
					headers,
					interpolateRecord(template.proxy.headers, context),
				);
			}
			if (template?.authenticate?.headers) {
				Object.assign(
					headers,
					interpolateRecord(template.authenticate.headers, context),
				);
			}
			if (options?.headers) {
				Object.assign(headers, options.headers);
			}

			return fetch(url, {
				method,
				headers,
				body: options?.body,
				signal: AbortSignal.timeout(options?.timeoutMs ?? 30_000),
			});
		};

		const response = await doRequest(false);

		// Retry on 401 — refresh token and try once more
		if (response.status === 401) {
			const retryResponse = await doRequest(true);
			if (retryResponse.status === 401) {
				throw new CredentialsInvalidError({
					connectionId,
					templateId: template?.id,
					provider: template?.name,
				});
			}
			if (retryResponse.status === 429) {
				const retryAfter = Number.parseInt(
					retryResponse.headers.get("retry-after") ?? "",
					10,
				);
				throw new RateLimitError({
					connectionId,
					retryAfter: Number.isNaN(retryAfter) ? undefined : retryAfter,
					templateId: template?.id,
					provider: template?.name,
				});
			}
			if (!retryResponse.ok) {
				throw new ProviderError(`Provider returned ${retryResponse.status}`, {
					connectionId,
					httpStatus: retryResponse.status,
					templateId: template?.id,
					provider: template?.name,
				});
			}
			return retryResponse;
		}

		if (response.status === 429) {
			const retryAfter = Number.parseInt(
				response.headers.get("retry-after") ?? "",
				10,
			);
			throw new RateLimitError({
				connectionId,
				retryAfter: Number.isNaN(retryAfter) ? undefined : retryAfter,
				templateId: template?.id,
				provider: template?.name,
			});
		}

		if (!response.ok) {
			throw new ProviderError(`Provider returned ${response.status}`, {
				connectionId,
				httpStatus: response.status,
				templateId: template?.id,
				provider: template?.name,
			});
		}

		return response;
	}

	/**
	 * Verify a connection is healthy using the template's verify config.
	 * Returns { success, error? }.
	 */
	async verifyConnection(
		connectionId: string,
	): Promise<{ success: boolean; error?: string }> {
		const template = await this.deps.getTemplateForConnection(connectionId);
		if (!template?.verify) {
			return { success: true };
		}

		try {
			await this.request(
				connectionId,
				template.verify.method,
				template.verify.path,
				{ timeoutMs: 10_000 },
			);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Connection failed",
			};
		}
	}
}
