import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import {
	IntegrationConnection,
	IntegrationDefinition,
	ServiceIntegration,
} from "@prismalens/database";
import type {
	GitOrganization,
	GitRepository,
	ServiceIntegrationWithStatus,
} from "@prismalens/contracts";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { CredentialsService } from "./crypto/credentials.service.js";
import {
	CreateConnectionDto,
	CreateServiceIntegrationDto,
	UpdateConnectionDto,
	UpdateOAuthConfigDto,
} from "./dto/index.js";
import {
	createGitProvider,
	isGitProviderSupported,
} from "./git-providers/index.js";

export type {
	IntegrationDefinition,
	IntegrationConnection,
	ServiceIntegration,
};

export interface IntegrationConnectionWithDefinition
	extends IntegrationConnection {
	definition: IntegrationDefinition;
}

export interface IntegrationContext {
	type: string;
	connectionId: string;
	credentials: Record<string, unknown>;
	config: Record<string, unknown>;
	serviceOverrides?: Record<string, unknown>;
}

@Injectable()
export class IntegrationsService {
	private readonly logger = new Logger(IntegrationsService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly credentialsService: CredentialsService,
	) {}

	// =========================================================================
	// INTEGRATION DEFINITIONS (Catalog)
	// =========================================================================

	async findAllDefinitions(): Promise<IntegrationDefinition[]> {
		return this.prisma.integrationDefinition.findMany({
			where: { isEnabled: true },
			orderBy: { name: "asc" },
		});
	}

	async findDefinitionByName(
		name: string,
	): Promise<IntegrationDefinition | null> {
		return this.prisma.integrationDefinition.findUnique({
			where: { name },
		});
	}

	async findDefinitionById(id: string): Promise<IntegrationDefinition | null> {
		return this.prisma.integrationDefinition.findUnique({
			where: { id },
		});
	}

	async updateOAuthConfig(
		name: string,
		dto: UpdateOAuthConfigDto,
	): Promise<IntegrationDefinition> {
		const definition = await this.findDefinitionByName(name);
		if (!definition) {
			throw new NotFoundException(`Integration definition '${name}' not found`);
		}

		if (definition.authType !== "oauth2" && definition.authType !== "both") {
			throw new BadRequestException(
				`Integration '${name}' does not support OAuth authentication`,
			);
		}

		const oauthConfig = {
			clientId: dto.clientId,
			clientSecret: dto.clientSecret,
			scopes: dto.scopes || this.getDefaultScopes(name),
			authUrl: dto.authUrl || this.getDefaultAuthUrl(name),
			tokenUrl: dto.tokenUrl || this.getDefaultTokenUrl(name),
		};

		const encryptedConfig = this.credentialsService.encrypt(oauthConfig);

		return this.prisma.integrationDefinition.update({
			where: { name },
			data: { oauthConfig: encryptedConfig },
		});
	}

	private getDefaultScopes(name: string): string[] {
		const defaults: Record<string, string[]> = {
			github: ["repo", "read:org", "read:user"],
			slack: ["chat:write", "channels:read", "users:read"],
		};
		return defaults[name] || [];
	}

	private getDefaultAuthUrl(name: string): string {
		const defaults: Record<string, string> = {
			github: "https://github.com/login/oauth/authorize",
			slack: "https://slack.com/oauth/v2/authorize",
		};
		return defaults[name] || "";
	}

	private getDefaultTokenUrl(name: string): string {
		const defaults: Record<string, string> = {
			github: "https://github.com/login/oauth/access_token",
			slack: "https://slack.com/api/oauth.v2.access",
		};
		return defaults[name] || "";
	}

	// =========================================================================
	// INTEGRATION CONNECTIONS (User Instances)
	// =========================================================================

	async createConnection(
		dto: CreateConnectionDto,
	): Promise<IntegrationConnection> {
		const definition = await this.findDefinitionById(dto.definitionId);
		if (!definition) {
			throw new NotFoundException("Integration definition not found");
		}

		// Validate auth method is supported by definition
		if (
			dto.authMethod === "api_key" &&
			definition.authType !== "api_key" &&
			definition.authType !== "both"
		) {
			throw new BadRequestException(
				`Integration '${definition.name}' does not support API key authentication`,
			);
		}

		if (
			dto.authMethod === "oauth2" &&
			definition.authType !== "oauth2" &&
			definition.authType !== "both"
		) {
			throw new BadRequestException(
				`Integration '${definition.name}' does not support OAuth authentication`,
			);
		}

		// Check CE limits for monitoring integrations
		if (
			definition.category === "monitoring" &&
			definition.maxConnectionsCE === 1
		) {
			const existingMonitoring = await this.prisma.integrationConnection.count({
				where: {
					definition: { category: "monitoring" },
					status: { in: ["connected", "pending"] },
				},
			});

			if (existingMonitoring > 0) {
				throw new BadRequestException(
					"Community Edition allows only one monitoring integration. " +
						"Please disconnect the existing one first.",
				);
			}
		}

		// Prepare credentials
		let credentials: Record<string, unknown>;
		if (dto.authMethod === "api_key") {
			if (!dto.apiKeyCredentials) {
				throw new BadRequestException("API key credentials required");
			}
			credentials = { ...dto.apiKeyCredentials };
		} else {
			if (!dto.oauthCredentials) {
				throw new BadRequestException("OAuth credentials required");
			}
			credentials = { ...dto.oauthCredentials };
		}

		const encryptedCredentials = this.credentialsService.encrypt(credentials);

		return this.prisma.integrationConnection.create({
			data: {
				definitionId: dto.definitionId,
				name: dto.name,
				description: dto.description,
				isGlobal: dto.isGlobal ?? true,
				authMethod: dto.authMethod,
				credentials: encryptedCredentials,
				config: dto.config ? JSON.stringify(dto.config) : null,
				status: "pending",
			},
		});
	}

	async findAllConnections(options?: {
		status?: string;
		definitionId?: string;
		isGlobal?: boolean;
	}): Promise<IntegrationConnectionWithDefinition[]> {
		return this.prisma.integrationConnection.findMany({
			where: {
				...(options?.status && { status: options.status }),
				...(options?.definitionId && { definitionId: options.definitionId }),
				...(options?.isGlobal !== undefined && { isGlobal: options.isGlobal }),
			},
			include: { definition: true },
			orderBy: { createdAt: "desc" },
		});
	}

	async findConnectionById(
		id: string,
	): Promise<IntegrationConnectionWithDefinition | null> {
		return this.prisma.integrationConnection.findUnique({
			where: { id },
			include: { definition: true },
		});
	}

	async findMonitoringConnection(): Promise<IntegrationConnectionWithDefinition | null> {
		return this.prisma.integrationConnection.findFirst({
			where: {
				definition: { category: "monitoring" },
				status: "connected",
			},
			include: { definition: true },
		});
	}

	async updateConnection(
		id: string,
		dto: UpdateConnectionDto,
	): Promise<IntegrationConnection | null> {
		const connection = await this.findConnectionById(id);
		if (!connection) {
			return null;
		}

		const updateData: Record<string, unknown> = {
			updatedAt: new Date(),
		};

		if (dto.name) updateData.name = dto.name;
		if (dto.description !== undefined) updateData.description = dto.description;
		if (dto.isGlobal !== undefined) updateData.isGlobal = dto.isGlobal;
		if (dto.status) updateData.status = dto.status;
		if (dto.config) updateData.config = JSON.stringify(dto.config);

		// Update credentials if provided
		if (dto.apiKeyCredentials || dto.oauthCredentials) {
			const credentials = dto.apiKeyCredentials || dto.oauthCredentials;
			updateData.credentials = this.credentialsService.encrypt(credentials);
		}

		return this.prisma.integrationConnection.update({
			where: { id },
			data: updateData,
		});
	}

	async deleteConnection(id: string): Promise<boolean> {
		try {
			await this.prisma.integrationConnection.delete({ where: { id } });
			return true;
		} catch {
			return false;
		}
	}

	async testConnection(
		id: string,
	): Promise<{ success: boolean; error?: string }> {
		const connection = await this.findConnectionById(id);
		if (!connection) {
			throw new NotFoundException("Connection not found");
		}

		try {
			const credentials = this.credentialsService.decrypt<
				Record<string, unknown>
			>(connection.credentials);
			const config = connection.config
				? (JSON.parse(connection.config) as Record<string, unknown>)
				: {};

			// Test based on integration type
			const testResult = await this.performHealthCheck(
				connection.definition.name,
				credentials,
				config,
			);

			// Update connection status
			await this.prisma.integrationConnection.update({
				where: { id },
				data: {
					status: testResult.success ? "connected" : "error",
					lastHealthCheck: new Date(),
					lastError: testResult.error || null,
				},
			});

			return testResult;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			await this.prisma.integrationConnection.update({
				where: { id },
				data: {
					status: "error",
					lastHealthCheck: new Date(),
					lastError: errorMessage,
				},
			});
			return { success: false, error: errorMessage };
		}
	}

	private async performHealthCheck(
		integrationType: string,
		credentials: Record<string, unknown>,
		config: Record<string, unknown>,
	): Promise<{ success: boolean; error?: string }> {
		switch (integrationType) {
			case "github":
				return this.testGitHubConnection(credentials);
			case "prometheus":
				return this.testPrometheusConnection(credentials, config);
			case "slack":
				return this.testSlackConnection(credentials);
			default:
				return { success: true };
		}
	}

	private async testGitHubConnection(
		credentials: Record<string, unknown>,
	): Promise<{ success: boolean; error?: string }> {
		try {
			const token = (credentials.apiKey || credentials.accessToken) as string;
			const response = await fetch("https://api.github.com/user", {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github.v3+json",
				},
			});

			if (response.ok) {
				return { success: true };
			}
			return {
				success: false,
				error: `GitHub API returned ${response.status}`,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Connection failed",
			};
		}
	}

	private async testPrometheusConnection(
		credentials: Record<string, unknown>,
		config: Record<string, unknown>,
	): Promise<{ success: boolean; error?: string }> {
		try {
			const baseUrl = (config.baseUrl as string) || "http://localhost:9090";
			const url = `${baseUrl}/api/v1/status/config`;

			const headers: Record<string, string> = {};
			if (credentials.username && credentials.password) {
				const auth = Buffer.from(
					`${credentials.username}:${credentials.password}`,
				).toString("base64");
				headers.Authorization = `Basic ${auth}`;
			}

			const response = await fetch(url, { headers });
			if (response.ok) {
				return { success: true };
			}
			return {
				success: false,
				error: `Prometheus returned ${response.status}`,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Connection failed",
			};
		}
	}

	private async testSlackConnection(
		credentials: Record<string, unknown>,
	): Promise<{ success: boolean; error?: string }> {
		try {
			const token = (credentials.apiKey || credentials.accessToken) as string;

			// If it's a webhook URL, just validate format
			if (token.startsWith("https://hooks.slack.com/")) {
				return { success: true };
			}

			// Otherwise test as bot token
			const response = await fetch("https://slack.com/api/auth.test", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
			});

			const data = (await response.json()) as { ok: boolean; error?: string };
			if (data.ok) {
				return { success: true };
			}
			return { success: false, error: data.error || "Slack auth test failed" };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Connection failed",
			};
		}
	}

	// =========================================================================
	// GIT PROVIDER OPERATIONS
	// =========================================================================

	/**
	 * Get organizations from a git provider connection.
	 */
	async getGitOrganizations(connectionId: string): Promise<GitOrganization[]> {
		const connection = await this.findConnectionById(connectionId);
		if (!connection) {
			throw new NotFoundException("Connection not found");
		}

		const providerName = connection.definition.name;
		if (!isGitProviderSupported(providerName)) {
			throw new BadRequestException(
				`'${providerName}' is not a supported git provider`,
			);
		}

		const provider = createGitProvider(providerName);
		if (!provider) {
			throw new BadRequestException(`Failed to create git provider for '${providerName}'`);
		}

		const credentials = this.credentialsService.decrypt<Record<string, unknown>>(
			connection.credentials,
		);
		const accessToken = (credentials.accessToken || credentials.apiKey) as string;

		if (!accessToken) {
			throw new BadRequestException("No access token found for this connection");
		}

		return provider.getOrganizations(accessToken);
	}

	/**
	 * Get repositories from a git provider connection.
	 */
	async getGitRepositories(
		connectionId: string,
		org?: string,
	): Promise<GitRepository[]> {
		const connection = await this.findConnectionById(connectionId);
		if (!connection) {
			throw new NotFoundException("Connection not found");
		}

		const providerName = connection.definition.name;
		if (!isGitProviderSupported(providerName)) {
			throw new BadRequestException(
				`'${providerName}' is not a supported git provider`,
			);
		}

		const provider = createGitProvider(providerName);
		if (!provider) {
			throw new BadRequestException(`Failed to create git provider for '${providerName}'`);
		}

		const credentials = this.credentialsService.decrypt<Record<string, unknown>>(
			connection.credentials,
		);
		const accessToken = (credentials.accessToken || credentials.apiKey) as string;

		if (!accessToken) {
			throw new BadRequestException("No access token found for this connection");
		}

		return provider.getRepositories(accessToken, org);
	}

	/**
	 * Update connection config (e.g., selected repos after OAuth).
	 */
	async updateConnectionConfig(
		connectionId: string,
		config: Record<string, unknown>,
	): Promise<IntegrationConnection> {
		const connection = await this.findConnectionById(connectionId);
		if (!connection) {
			throw new NotFoundException("Connection not found");
		}

		// Merge with existing config
		const existingConfig = connection.config
			? (JSON.parse(connection.config) as Record<string, unknown>)
			: {};
		const mergedConfig = { ...existingConfig, ...config };

		return this.prisma.integrationConnection.update({
			where: { id: connectionId },
			data: {
				config: JSON.stringify(mergedConfig),
				// If status was pending_config, mark as connected now
				status: connection.status === "pending" ? "connected" : connection.status,
			},
		});
	}

	// =========================================================================
	// SERVICE INTEGRATIONS (Service-Level Mappings)
	// =========================================================================

	/**
	 * Create a service integration override.
	 */
	async createServiceIntegration(
		dto: CreateServiceIntegrationDto,
	): Promise<ServiceIntegration> {
		const connection = await this.findConnectionById(dto.connectionId);
		if (!connection) {
			throw new NotFoundException("Integration connection not found");
		}

		// Check if override already exists
		const existing = await this.prisma.serviceIntegration.findUnique({
			where: {
				serviceId_connectionId: {
					serviceId: dto.serviceId,
					connectionId: dto.connectionId,
				},
			},
		});

		if (existing) {
			throw new BadRequestException(
				"A service integration override already exists for this connection",
			);
		}

		return this.prisma.serviceIntegration.create({
			data: {
				serviceId: dto.serviceId,
				connectionId: dto.connectionId,
				config: dto.config ? JSON.stringify(dto.config) : null,
				priority: dto.priority ?? 0,
				isEnabled: dto.isEnabled ?? true,
			},
		});
	}

	/**
	 * Update a service integration override by ID.
	 */
	async updateServiceIntegrationById(
		id: string,
		data: { priority?: number; config?: Record<string, unknown>; isEnabled?: boolean },
	): Promise<ServiceIntegration | null> {
		const existing = await this.prisma.serviceIntegration.findUnique({
			where: { id },
		});

		if (!existing) {
			return null;
		}

		const updateData: Record<string, unknown> = { updatedAt: new Date() };
		if (data.priority !== undefined) updateData.priority = data.priority;
		if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;
		if (data.config !== undefined) updateData.config = JSON.stringify(data.config);

		return this.prisma.serviceIntegration.update({
			where: { id },
			data: updateData,
		});
	}

	/**
	 * Delete a service integration override by ID.
	 */
	async deleteServiceIntegrationById(id: string): Promise<boolean> {
		try {
			await this.prisma.serviceIntegration.delete({ where: { id } });
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get all integrations for a service with override status.
	 * Returns both global integrations and service-specific overrides.
	 */
	async getServiceIntegrationsWithStatus(
		serviceId: string,
	): Promise<ServiceIntegrationWithStatus[]> {
		// Get all connected global integrations
		const globalConnections = await this.prisma.integrationConnection.findMany({
			where: { isGlobal: true, status: "connected" },
			include: { definition: true },
		});

		// Get service-specific overrides
		const serviceOverrides = await this.prisma.serviceIntegration.findMany({
			where: { serviceId },
			include: {
				connection: {
					include: { definition: true },
				},
			},
		});

		// Build map of overrides by connection ID
		const overridesByConnectionId = new Map(
			serviceOverrides.map((so) => [so.connectionId, so]),
		);

		const results: ServiceIntegrationWithStatus[] = [];

		// Process global integrations
		for (const conn of globalConnections) {
			const override = overridesByConnectionId.get(conn.id);
			const globalConfig = conn.config
				? (JSON.parse(conn.config) as Record<string, unknown>)
				: null;
			const serviceConfig = override?.config
				? (JSON.parse(override.config) as Record<string, unknown>)
				: null;

			results.push({
				connectionId: conn.id,
				connectionName: conn.name,
				definitionName: conn.definition.name,
				definitionDisplayName: conn.definition.displayName,
				category: conn.definition.category,
				status: conn.status as "connected" | "pending" | "error" | "disabled",
				isGlobal: true,
				hasOverride: !!override,
				overrideId: override?.id,
				globalConfig,
				serviceConfig,
				effectiveConfig: serviceConfig ?? globalConfig,
			});
		}

		// Add non-global service-specific connections (if any)
		for (const override of serviceOverrides) {
			if (!override.connection.isGlobal) {
				const globalConfig = override.connection.config
					? (JSON.parse(override.connection.config) as Record<string, unknown>)
					: null;
				const serviceConfig = override.config
					? (JSON.parse(override.config) as Record<string, unknown>)
					: null;

				results.push({
					connectionId: override.connectionId,
					connectionName: override.connection.name,
					definitionName: override.connection.definition.name,
					definitionDisplayName: override.connection.definition.displayName,
					category: override.connection.definition.category,
					status: override.connection.status as "connected" | "pending" | "error" | "disabled",
					isGlobal: false,
					hasOverride: true,
					overrideId: override.id,
					globalConfig,
					serviceConfig,
					effectiveConfig: serviceConfig ?? globalConfig,
				});
			}
		}

		return results;
	}

	async findServiceIntegrations(serviceId: string): Promise<
		(ServiceIntegration & {
			connection: IntegrationConnectionWithDefinition;
		})[]
	> {
		return this.prisma.serviceIntegration.findMany({
			where: { serviceId, isEnabled: true },
			include: {
				connection: {
					include: { definition: true },
				},
			},
			orderBy: { priority: "desc" },
		});
	}

	async deleteServiceIntegration(
		serviceId: string,
		connectionId: string,
	): Promise<boolean> {
		try {
			await this.prisma.serviceIntegration.delete({
				where: {
					serviceId_connectionId: { serviceId, connectionId },
				},
			});
			return true;
		} catch {
			return false;
		}
	}

	// =========================================================================
	// INTEGRATION CONTEXT FOR WORKER
	// =========================================================================

	/**
	 * Get all integrations for a service (for passing to worker).
	 * Includes global integrations and service-specific mappings.
	 * Decrypts credentials for use by the worker.
	 */
	async getIntegrationsForService(
		serviceId?: string,
	): Promise<IntegrationContext[]> {
		const contexts: IntegrationContext[] = [];

		// Get global integrations
		const globalConnections = await this.prisma.integrationConnection.findMany({
			where: { isGlobal: true, status: "connected" },
			include: { definition: true },
		});

		for (const conn of globalConnections) {
			const credentials = this.credentialsService.decrypt<
				Record<string, unknown>
			>(conn.credentials);
			const config = conn.config
				? (JSON.parse(conn.config) as Record<string, unknown>)
				: {};

			contexts.push({
				type: conn.definition.name,
				connectionId: conn.id,
				credentials,
				config,
			});
		}

		// Get service-specific integrations (with overrides)
		if (serviceId) {
			const serviceIntegrations = await this.findServiceIntegrations(serviceId);

			for (const si of serviceIntegrations) {
				const existingIndex = contexts.findIndex(
					(c) => c.connectionId === si.connectionId,
				);

				const serviceOverrides = si.config
					? (JSON.parse(si.config) as Record<string, unknown>)
					: undefined;

				if (existingIndex >= 0) {
					// Add service overrides to existing global integration
					contexts[existingIndex].serviceOverrides = serviceOverrides;
				} else {
					// Add non-global service-specific integration
					const credentials = this.credentialsService.decrypt<
						Record<string, unknown>
					>(si.connection.credentials);
					const config = si.connection.config
						? (JSON.parse(si.connection.config) as Record<string, unknown>)
						: {};

					contexts.push({
						type: si.connection.definition.name,
						connectionId: si.connectionId,
						credentials,
						config,
						serviceOverrides,
					});
				}
			}
		}

		return contexts;
	}

	/**
	 * Get a connection with decrypted (but masked) credentials for API response.
	 */
	async getConnectionWithMaskedCredentials(id: string): Promise<
		| (IntegrationConnectionWithDefinition & {
				maskedCredentials: Record<string, unknown>;
		  })
		| null
	> {
		const connection = await this.findConnectionById(id);
		if (!connection) {
			return null;
		}

		const credentials = this.credentialsService.decrypt<
			Record<string, unknown>
		>(connection.credentials);
		const maskedCredentials = this.credentialsService.mask(credentials);

		return {
			...connection,
			maskedCredentials,
		};
	}
}
