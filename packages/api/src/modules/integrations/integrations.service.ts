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
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { CredentialsService } from "./crypto/credentials.service.js";
import {
	CreateConnectionDto,
	CreateServiceIntegrationDto,
	UpdateConnectionDto,
	UpdateOAuthConfigDto,
} from "./dto/index.js";

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
	// SERVICE INTEGRATIONS (Service-Level Mappings)
	// =========================================================================

	async createServiceIntegration(
		serviceId: string,
		dto: CreateServiceIntegrationDto,
	): Promise<ServiceIntegration> {
		const connection = await this.findConnectionById(dto.connectionId);
		if (!connection) {
			throw new NotFoundException("Integration connection not found");
		}

		return this.prisma.serviceIntegration.create({
			data: {
				serviceId,
				connectionId: dto.connectionId,
				config: dto.config ? JSON.stringify(dto.config) : null,
				priority: dto.priority ?? 0,
				isEnabled: true,
			},
		});
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
