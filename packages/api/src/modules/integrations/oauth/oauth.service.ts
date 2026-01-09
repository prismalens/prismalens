import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { IntegrationConnection } from "@prismalens/database";
import { PrismaService } from "../../../core/prisma/prisma.service.js";
import { CredentialsService } from "../crypto/credentials.service.js";

export interface OAuthConfig {
	clientId: string;
	clientSecret: string;
	scopes: string[];
	authUrl: string;
	tokenUrl: string;
}

export interface OAuthTokens {
	accessToken: string;
	refreshToken?: string;
	expiresAt?: string;
	tokenType?: string;
	scope?: string;
}

export interface OAuthState {
	definitionId: string;
	connectionName: string;
	redirectUri: string;
	nonce: string;
}

@Injectable()
export class OAuthService {
	private readonly logger = new Logger(OAuthService.name);
	private readonly stateStore = new Map<string, OAuthState>();

	constructor(
		private readonly prisma: PrismaService,
		private readonly credentialsService: CredentialsService,
	) {}

	/**
	 * Get the OAuth configuration for a provider.
	 */
	async getOAuthConfig(provider: string): Promise<OAuthConfig | null> {
		const definition = await this.prisma.integrationDefinition.findUnique({
			where: { name: provider },
		});

		if (!definition || !definition.oauthConfig) {
			return null;
		}

		try {
			return this.credentialsService.decrypt<OAuthConfig>(
				definition.oauthConfig,
			);
		} catch {
			this.logger.error(`Failed to decrypt OAuth config for ${provider}`);
			return null;
		}
	}

	/**
	 * Generate the OAuth authorization URL for a provider.
	 */
	async getAuthorizationUrl(
		provider: string,
		connectionName: string,
		redirectUri: string,
	): Promise<string> {
		const definition = await this.prisma.integrationDefinition.findUnique({
			where: { name: provider },
		});

		if (!definition) {
			throw new NotFoundException(`Integration '${provider}' not found`);
		}

		if (definition.authType !== "oauth2" && definition.authType !== "both") {
			throw new BadRequestException(
				`Integration '${provider}' does not support OAuth`,
			);
		}

		const oauthConfig = await this.getOAuthConfig(provider);
		if (!oauthConfig) {
			throw new BadRequestException(
				`OAuth not configured for '${provider}'. Admin must configure OAuth app credentials first.`,
			);
		}

		// Generate state parameter for CSRF protection
		const nonce = this.generateNonce();
		const state = Buffer.from(
			JSON.stringify({
				definitionId: definition.id,
				connectionName,
				redirectUri,
				nonce,
			}),
		).toString("base64url");

		// Store state for validation
		this.stateStore.set(state, {
			definitionId: definition.id,
			connectionName,
			redirectUri,
			nonce,
		});

		// Clean up old states after 10 minutes
		setTimeout(() => this.stateStore.delete(state), 10 * 60 * 1000);

		// Build authorization URL
		const params = new URLSearchParams({
			client_id: oauthConfig.clientId,
			redirect_uri: redirectUri,
			scope: oauthConfig.scopes.join(" "),
			state,
			response_type: "code",
		});

		// Provider-specific parameters
		if (provider === "github") {
			params.set("allow_signup", "false");
		} else if (provider === "slack") {
			// Slack uses different parameter names
			params.set("user_scope", oauthConfig.scopes.join(","));
		}

		return `${oauthConfig.authUrl}?${params.toString()}`;
	}

	/**
	 * Exchange authorization code for tokens and create connection.
	 */
	async handleCallback(
		provider: string,
		code: string,
		state: string,
	): Promise<IntegrationConnection> {
		// Validate state
		const storedState = this.stateStore.get(state);
		if (!storedState) {
			throw new BadRequestException("Invalid or expired OAuth state");
		}

		this.stateStore.delete(state);

		const oauthConfig = await this.getOAuthConfig(provider);
		if (!oauthConfig) {
			throw new BadRequestException(`OAuth not configured for '${provider}'`);
		}

		// Exchange code for tokens
		const tokens = await this.exchangeCodeForTokens(
			provider,
			code,
			storedState.redirectUri,
			oauthConfig,
		);

		// Create or update the connection
		const connection = await this.createOrUpdateConnection(
			storedState.definitionId,
			storedState.connectionName,
			tokens,
		);

		this.logger.log(
			`OAuth connection created: ${connection.id} for ${provider}`,
		);
		return connection;
	}

	/**
	 * Exchange authorization code for access/refresh tokens.
	 */
	private async exchangeCodeForTokens(
		provider: string,
		code: string,
		redirectUri: string,
		oauthConfig: OAuthConfig,
	): Promise<OAuthTokens> {
		const body = new URLSearchParams({
			client_id: oauthConfig.clientId,
			client_secret: oauthConfig.clientSecret,
			code,
			redirect_uri: redirectUri,
			grant_type: "authorization_code",
		});

		const headers: Record<string, string> = {
			"Content-Type": "application/x-www-form-urlencoded",
		};

		// GitHub requires Accept header for JSON response
		if (provider === "github") {
			headers.Accept = "application/json";
		}

		const response = await fetch(oauthConfig.tokenUrl, {
			method: "POST",
			headers,
			body: body.toString(),
		});

		if (!response.ok) {
			const errorText = await response.text();
			this.logger.error(`Token exchange failed: ${errorText}`);
			throw new BadRequestException(
				"Failed to exchange authorization code for tokens",
			);
		}

		const data = await response.json();

		// Handle provider-specific response formats
		if (provider === "github") {
			return this.parseGitHubTokenResponse(data);
		} else if (provider === "slack") {
			return this.parseSlackTokenResponse(data);
		}

		return this.parseStandardTokenResponse(data);
	}

	private parseGitHubTokenResponse(data: Record<string, unknown>): OAuthTokens {
		if (data.error) {
			throw new BadRequestException(
				`GitHub OAuth error: ${data.error_description || data.error}`,
			);
		}

		return {
			accessToken: data.access_token as string,
			refreshToken: data.refresh_token as string | undefined,
			tokenType: data.token_type as string | undefined,
			scope: data.scope as string | undefined,
		};
	}

	private parseSlackTokenResponse(data: Record<string, unknown>): OAuthTokens {
		if (!data.ok) {
			throw new BadRequestException(`Slack OAuth error: ${data.error}`);
		}

		// Slack returns tokens in authed_user for user tokens
		const authedUser = data.authed_user as Record<string, unknown> | undefined;
		const accessToken = (authedUser?.access_token ||
			data.access_token) as string;

		return {
			accessToken,
			refreshToken: data.refresh_token as string | undefined,
			tokenType: "Bearer",
			scope: (authedUser?.scope || data.scope) as string | undefined,
		};
	}

	private parseStandardTokenResponse(
		data: Record<string, unknown>,
	): OAuthTokens {
		const expiresIn = data.expires_in as number | undefined;
		const expiresAt = expiresIn
			? new Date(Date.now() + expiresIn * 1000).toISOString()
			: undefined;

		return {
			accessToken: data.access_token as string,
			refreshToken: data.refresh_token as string | undefined,
			expiresAt,
			tokenType: data.token_type as string | undefined,
			scope: data.scope as string | undefined,
		};
	}

	/**
	 * Create or update an integration connection with OAuth tokens.
	 */
	private async createOrUpdateConnection(
		definitionId: string,
		name: string,
		tokens: OAuthTokens,
	): Promise<IntegrationConnection> {
		const encryptedCredentials = this.credentialsService.encrypt(tokens);

		// Check if connection already exists
		const existing = await this.prisma.integrationConnection.findFirst({
			where: { definitionId, name },
		});

		if (existing) {
			return this.prisma.integrationConnection.update({
				where: { id: existing.id },
				data: {
					credentials: encryptedCredentials,
					authMethod: "oauth2",
					status: "connected",
					lastHealthCheck: new Date(),
					lastError: null,
				},
			});
		}

		return this.prisma.integrationConnection.create({
			data: {
				definitionId,
				name,
				authMethod: "oauth2",
				credentials: encryptedCredentials,
				status: "connected",
				isGlobal: true,
				lastHealthCheck: new Date(),
			},
		});
	}

	/**
	 * Refresh an expired OAuth token.
	 */
	async refreshToken(
		connectionId: string,
	): Promise<IntegrationConnection | null> {
		const connection = await this.prisma.integrationConnection.findUnique({
			where: { id: connectionId },
			include: { definition: true },
		});

		if (!connection || connection.authMethod !== "oauth2") {
			return null;
		}

		const credentials = this.credentialsService.decrypt<OAuthTokens>(
			connection.credentials,
		);
		if (!credentials.refreshToken) {
			this.logger.warn(
				`No refresh token available for connection ${connectionId}`,
			);
			return null;
		}

		const oauthConfig = await this.getOAuthConfig(connection.definition.name);
		if (!oauthConfig) {
			return null;
		}

		try {
			const body = new URLSearchParams({
				client_id: oauthConfig.clientId,
				client_secret: oauthConfig.clientSecret,
				refresh_token: credentials.refreshToken,
				grant_type: "refresh_token",
			});

			const response = await fetch(oauthConfig.tokenUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Accept: "application/json",
				},
				body: body.toString(),
			});

			if (!response.ok) {
				throw new Error(`Token refresh failed: ${response.status}`);
			}

			const data = await response.json();
			const newTokens = this.parseStandardTokenResponse(data);

			// Preserve refresh token if new one not provided
			if (!newTokens.refreshToken && credentials.refreshToken) {
				newTokens.refreshToken = credentials.refreshToken;
			}

			const encryptedCredentials = this.credentialsService.encrypt(newTokens);

			return this.prisma.integrationConnection.update({
				where: { id: connectionId },
				data: {
					credentials: encryptedCredentials,
					status: "connected",
					lastHealthCheck: new Date(),
					lastError: null,
				},
			});
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Token refresh failed";
			this.logger.error(
				`Failed to refresh token for ${connectionId}: ${errorMessage}`,
			);

			await this.prisma.integrationConnection.update({
				where: { id: connectionId },
				data: {
					status: "error",
					lastError: errorMessage,
				},
			});

			return null;
		}
	}

	private generateNonce(): string {
		const array = new Uint8Array(16);
		crypto.getRandomValues(array);
		return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
			"",
		);
	}
}
