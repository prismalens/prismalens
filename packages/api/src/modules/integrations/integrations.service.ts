import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Connection,
  Integration,
  ServiceIntegration,
} from '@prismalens/database';
import type {
  GitOrganization,
  GitRepository,
  ServiceIntegrationWithStatus,
} from '@prismalens/contracts';
import {
  getAllTemplates,
  getTemplate,
  type AuthTemplate,
} from '@prismalens/integrations';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { CredentialsService } from './crypto/credentials.service.js';
import type {
  CreateIntegrationDto,
  CreateConnectionDto,
  CreateServiceIntegrationDto,
} from './dto/create-connection.dto.js';
import type {
  UpdateIntegrationDto,
  UpdateConnectionDto,
} from './dto/update-connection.dto.js';
import {
  createGitProvider,
  isGitProviderSupported,
} from './git-providers/index.js';

export interface ConnectionWithIntegration extends Connection {
  integration: Integration;
}

export interface IntegrationContext {
  type: string;
  connectionId: string;
  credentials: Record<string, unknown>;
  config: Record<string, unknown>;
  specUrl?: string | null;
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
  // TEMPLATES (from @prismalens/integrations package)
  // =========================================================================

  findAllTemplates(): AuthTemplate[] {
    return getAllTemplates();
  }

  findTemplateById(id: string): AuthTemplate | undefined {
    return getTemplate(id);
  }

  // =========================================================================
  // INTEGRATIONS (OAuth client creds / provider instances)
  // =========================================================================

  async createIntegration(dto: CreateIntegrationDto): Promise<Integration> {
    const template = getTemplate(dto.templateId);
    if (!template) {
      throw new NotFoundException(`Template '${dto.templateId}' not found`);
    }

    return this.prisma.integration.create({
      data: {
        templateId: dto.templateId,
        label: dto.label,
        clientIdEnc: dto.clientId
          ? this.credentialsService.encrypt(dto.clientId)
          : null,
        clientSecretEnc: dto.clientSecret
          ? this.credentialsService.encrypt(dto.clientSecret)
          : null,
        scopes: JSON.stringify(dto.scopes ?? template.oauth2?.scopes ?? []),
        callbackUrl: dto.callbackUrl,
      },
    });
  }

  async findAllIntegrations(options?: {
    templateId?: string;
  }): Promise<Integration[]> {
    return this.prisma.integration.findMany({
      where: {
        ...(options?.templateId && { templateId: options.templateId }),
        enabled: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findIntegrationById(id: string): Promise<Integration | null> {
    return this.prisma.integration.findUnique({ where: { id } });
  }

  async updateIntegration(
    id: string,
    dto: UpdateIntegrationDto,
  ): Promise<Integration | null> {
    const existing = await this.findIntegrationById(id);
    if (!existing) return null;

    const updateData: Record<string, unknown> = {};

    if (dto.label !== undefined) updateData.label = dto.label;
    if (dto.scopes !== undefined)
      updateData.scopes = JSON.stringify(dto.scopes);
    if (dto.callbackUrl !== undefined) updateData.callbackUrl = dto.callbackUrl;
    if (dto.enabled !== undefined) updateData.enabled = dto.enabled;
    if (dto.clientId !== undefined) {
      updateData.clientIdEnc = this.credentialsService.encrypt(dto.clientId);
    }
    if (dto.clientSecret !== undefined) {
      updateData.clientSecretEnc = this.credentialsService.encrypt(
        dto.clientSecret,
      );
    }

    return this.prisma.integration.update({
      where: { id },
      data: updateData,
    });
  }

  async deleteIntegration(id: string): Promise<boolean> {
    try {
      await this.prisma.integration.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  getClientCredentials(integration: Integration): {
    clientId: string;
    clientSecret: string;
  } {
    const vault = this.credentialsService.getVault();
    if (!integration.clientIdEnc || !integration.clientSecretEnc) {
      throw new BadRequestException(
        'Integration does not have OAuth credentials configured',
      );
    }
    return {
      clientId: vault.decrypt(Buffer.from(integration.clientIdEnc)),
      clientSecret: vault.decrypt(Buffer.from(integration.clientSecretEnc)),
    };
  }

  // =========================================================================
  // CONNECTIONS (user tokens / API keys)
  // =========================================================================

  async createConnection(
    dto: CreateConnectionDto,
    userId: string,
  ): Promise<Connection> {
    const integration = await this.findIntegrationById(dto.integrationId);
    if (!integration) {
      throw new NotFoundException('Integration not found');
    }

    return this.prisma.connection.create({
      data: {
        integrationId: dto.integrationId,
        userId,
        credentialsEnc: this.credentialsService.encrypt(dto.credentials),
        connectionConfigEnc: dto.connectionConfig
          ? this.credentialsService.encrypt(dto.connectionConfig)
          : null,
        status: 'ACTIVE',
      },
    });
  }

  async findAllConnections(options?: {
    status?: string;
    integrationId?: string;
    userId?: string;
  }): Promise<ConnectionWithIntegration[]> {
    return this.prisma.connection.findMany({
      where: {
        ...(options?.status && { status: options.status }),
        ...(options?.integrationId && {
          integrationId: options.integrationId,
        }),
        ...(options?.userId && { userId: options.userId }),
      },
      include: { integration: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findConnectionById(
    id: string,
    userId?: string,
  ): Promise<ConnectionWithIntegration | null> {
    return this.prisma.connection.findFirst({
      where: { id, ...(userId && { userId }) },
      include: { integration: true },
    });
  }

  async updateConnection(
    id: string,
    dto: UpdateConnectionDto,
    userId?: string,
  ): Promise<Connection | null> {
    const connection = await this.findConnectionById(id, userId);
    if (!connection) return null;

    const updateData: Record<string, unknown> = {};

    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.credentials) {
      updateData.credentialsEnc = this.credentialsService.encrypt(
        dto.credentials,
      );
    }
    if (dto.connectionConfig) {
      updateData.connectionConfigEnc = this.credentialsService.encrypt(
        dto.connectionConfig,
      );
    }

    return this.prisma.connection.update({
      where: { id },
      data: updateData,
    });
  }

  async deleteConnection(id: string, userId?: string): Promise<boolean> {
    const connection = await this.findConnectionById(id, userId);
    if (!connection) return false;

    try {
      await this.prisma.connection.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async testConnection(
    id: string,
    userId?: string,
  ): Promise<{ success: boolean; error?: string }> {
    const connection = await this.findConnectionById(id, userId);
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    const template = getTemplate(connection.integration.templateId);
    if (!template) {
      return { success: false, error: 'Unknown template' };
    }

    try {
      const credentials = this.credentialsService.decrypt<
        Record<string, unknown>
      >(Buffer.from(connection.credentialsEnc));
      const config = connection.connectionConfigEnc
        ? this.credentialsService.decrypt<Record<string, unknown>>(
            Buffer.from(connection.connectionConfigEnc),
          )
        : {};

      const testResult = await this.performHealthCheck(
        template,
        credentials,
        config,
      );

      await this.prisma.connection.update({
        where: { id },
        data: {
          status: testResult.success ? 'ACTIVE' : 'ERROR',
          lastUsedAt: new Date(),
          lastErrorMessage: testResult.error ?? null,
          lastErrorAt: testResult.success ? null : new Date(),
          consecutiveErrors: testResult.success
            ? 0
            : connection.consecutiveErrors + 1,
        },
      });

      return testResult;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      await this.prisma.connection.update({
        where: { id },
        data: {
          status: 'ERROR',
          lastErrorMessage: errorMessage,
          lastErrorAt: new Date(),
          consecutiveErrors: connection.consecutiveErrors + 1,
        },
      });
      return { success: false, error: errorMessage };
    }
  }

  private async performHealthCheck(
    template: AuthTemplate,
    credentials: Record<string, unknown>,
    config: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }> {
    // Use the template's verify endpoint if available
    if (!template.verify) {
      return { success: true };
    }

    // Route to provider-specific test logic
    const baseTemplateId = template.id.replace(/-oauth2$|-token$/, '');
    switch (baseTemplateId) {
      case 'github':
        return this.testGitHubConnection(credentials);
      case 'prometheus':
        return this.testPrometheusConnection(credentials, config);
      case 'slack':
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
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
        redirect: 'error',
      });

      if (response.ok) return { success: true };
      return {
        success: false,
        error: `GitHub API returned ${response.status}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  private static readonly PROMETHEUS_ALLOWED_HOSTS = [
    'localhost',
    '127.0.0.1',
    '::1',
  ];

  private async testPrometheusConnection(
    credentials: Record<string, unknown>,
    config: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const baseUrl =
        (config.baseUrl as string | undefined) || 'http://localhost:9090';

      const parsed = new URL(baseUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
          success: false,
          error: `Unsupported protocol: ${parsed.protocol}`,
        };
      }
      if (
        !IntegrationsService.PROMETHEUS_ALLOWED_HOSTS.includes(parsed.hostname)
      ) {
        return {
          success: false,
          error: `Host "${parsed.hostname}" is not allowed. Allowed: ${IntegrationsService.PROMETHEUS_ALLOWED_HOSTS.join(', ')}`,
        };
      }

      const url = `${baseUrl}/api/v1/status/config`;
      const headers: Record<string, string> = {};
      if (credentials.username && credentials.apiKey) {
        headers.Authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.apiKey}`).toString('base64')}`;
      }

      const response = await fetch(url, { headers, redirect: 'error' });
      if (response.ok) return { success: true };
      return {
        success: false,
        error: `Prometheus returned ${response.status}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  private async testSlackConnection(
    credentials: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const token = (credentials.apiKey || credentials.accessToken) as string;

      if (token.startsWith('https://hooks.slack.com/')) {
        return { success: true };
      }

      const response = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        redirect: 'error',
      });

      const data = (await response.json()) as { ok: boolean; error?: string };
      if (data.ok) return { success: true };
      return { success: false, error: data.error || 'Slack auth test failed' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  // =========================================================================
  // GIT PROVIDER OPERATIONS
  // =========================================================================

  async getGitOrganizations(
    connectionId: string,
    userId?: string,
  ): Promise<GitOrganization[]> {
    const connection = await this.findConnectionById(connectionId, userId);
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    const providerName = this.getGitProviderName(
      connection.integration.templateId,
    );
    if (!providerName || !isGitProviderSupported(providerName)) {
      throw new BadRequestException('Not a supported git provider');
    }

    const provider = createGitProvider(providerName);
    if (!provider) {
      throw new BadRequestException('Failed to create git provider');
    }

    const credentials = this.credentialsService.decrypt<
      Record<string, unknown>
    >(Buffer.from(connection.credentialsEnc));
    const accessToken = (credentials.accessToken ||
      credentials.apiKey) as string;

    if (!accessToken) {
      throw new BadRequestException('No access token found');
    }

    return provider.getOrganizations(accessToken);
  }

  async getGitRepositories(
    connectionId: string,
    org?: string,
    userId?: string,
  ): Promise<GitRepository[]> {
    const connection = await this.findConnectionById(connectionId, userId);
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    const providerName = this.getGitProviderName(
      connection.integration.templateId,
    );
    if (!providerName || !isGitProviderSupported(providerName)) {
      throw new BadRequestException('Not a supported git provider');
    }

    const provider = createGitProvider(providerName);
    if (!provider) {
      throw new BadRequestException('Failed to create git provider');
    }

    const credentials = this.credentialsService.decrypt<
      Record<string, unknown>
    >(Buffer.from(connection.credentialsEnc));
    const accessToken = (credentials.accessToken ||
      credentials.apiKey) as string;

    if (!accessToken) {
      throw new BadRequestException('No access token found');
    }

    return provider.getRepositories(accessToken, org);
  }

  async updateConnectionConfig(
    connectionId: string,
    config: Record<string, unknown>,
    userId?: string,
  ): Promise<Connection> {
    const connection = await this.findConnectionById(connectionId, userId);
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    const existingConfig = connection.connectionConfigEnc
      ? this.credentialsService.decrypt<Record<string, unknown>>(
          Buffer.from(connection.connectionConfigEnc),
        )
      : {};
    const mergedConfig = { ...existingConfig, ...config };

    return this.prisma.connection.update({
      where: { id: connectionId },
      data: {
        connectionConfigEnc: this.credentialsService.encrypt(mergedConfig),
      },
    });
  }

  private getGitProviderName(templateId: string): string | null {
    // github-oauth2, github-token → github
    if (templateId.startsWith('github')) return 'github';
    if (templateId.startsWith('gitlab')) return 'gitlab';
    if (templateId.startsWith('bitbucket')) return 'bitbucket';
    return null;
  }

  // =========================================================================
  // SERVICE INTEGRATIONS (Per-service overrides)
  // =========================================================================

  async createServiceIntegration(
    dto: CreateServiceIntegrationDto,
  ): Promise<ServiceIntegration> {
    const connection = await this.findConnectionById(dto.connectionId);
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

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
        'A service integration override already exists for this connection',
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

  async updateServiceIntegrationById(
    id: string,
    data: {
      priority?: number;
      config?: Record<string, unknown>;
      isEnabled?: boolean;
    },
  ): Promise<ServiceIntegration | null> {
    const existing = await this.prisma.serviceIntegration.findUnique({
      where: { id },
    });
    if (!existing) return null;

    const updateData: Record<string, unknown> = {};
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;
    if (data.config !== undefined)
      updateData.config = JSON.stringify(data.config);

    return this.prisma.serviceIntegration.update({
      where: { id },
      data: updateData,
    });
  }

  async deleteServiceIntegrationById(id: string): Promise<boolean> {
    try {
      await this.prisma.serviceIntegration.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async getServiceIntegrationsWithStatus(
    serviceId: string,
  ): Promise<ServiceIntegrationWithStatus[]> {
    const activeConnections = await this.prisma.connection.findMany({
      where: { status: 'ACTIVE' },
      include: { integration: true },
    });

    const serviceOverrides = await this.prisma.serviceIntegration.findMany({
      where: { serviceId },
      include: {
        connection: {
          include: { integration: true },
        },
      },
    });

    const overridesByConnectionId = new Map(
      serviceOverrides.map((so) => [so.connectionId, so]),
    );

    const results: ServiceIntegrationWithStatus[] = [];

    for (const conn of activeConnections) {
      const template = getTemplate(conn.integration.templateId);
      const override = overridesByConnectionId.get(conn.id);
      const connectionConfig = conn.connectionConfigEnc
        ? this.credentialsService.decrypt<Record<string, unknown>>(
            Buffer.from(conn.connectionConfigEnc),
          )
        : null;
      let serviceConfig: Record<string, unknown> | null = null;
      if (override?.config) {
        try {
          serviceConfig = JSON.parse(override.config) as Record<
            string,
            unknown
          >;
        } catch {
          this.logger.warn(
            `Invalid JSON in service integration config: ${override.id}`,
          );
        }
      }

      results.push({
        connectionId: conn.id,
        connectionName: conn.integration.label,
        templateId: conn.integration.templateId,
        templateName: template?.name ?? conn.integration.templateId,
        category: template?.category ?? 'unknown',
        status: conn.status as
          | 'ACTIVE'
          | 'TOKEN_EXPIRED'
          | 'REFRESH_FAILED'
          | 'CREDENTIALS_INVALID'
          | 'REVOKED'
          | 'ERROR',
        isGlobal: true,
        hasOverride: !!override,
        overrideId: override?.id,
        globalConfig: connectionConfig,
        serviceConfig,
        effectiveConfig: serviceConfig ?? connectionConfig,
      });
    }

    return results;
  }

  async findServiceIntegrations(serviceId: string): Promise<
    (ServiceIntegration & {
      connection: ConnectionWithIntegration;
    })[]
  > {
    return this.prisma.serviceIntegration.findMany({
      where: { serviceId, isEnabled: true },
      include: {
        connection: {
          include: { integration: true },
        },
      },
      orderBy: { priority: 'desc' },
    });
  }

  // =========================================================================
  // INTEGRATION CONTEXT FOR WORKER
  // =========================================================================

  async getIntegrationsForService(
    serviceId?: string,
  ): Promise<IntegrationContext[]> {
    const contexts: IntegrationContext[] = [];

    const activeConnections = await this.prisma.connection.findMany({
      where: { status: 'ACTIVE' },
      include: { integration: true },
      take: 1000,
    });

    for (const conn of activeConnections) {
      const credentials = this.credentialsService.decrypt<
        Record<string, unknown>
      >(Buffer.from(conn.credentialsEnc));
      const config = conn.connectionConfigEnc
        ? this.credentialsService.decrypt<Record<string, unknown>>(
            Buffer.from(conn.connectionConfigEnc),
          )
        : {};

      contexts.push({
        type:
          this.getGitProviderName(conn.integration.templateId) ??
          conn.integration.templateId,
        connectionId: conn.id,
        credentials,
        config,
      });
    }

    if (serviceId) {
      const serviceIntegrations = await this.findServiceIntegrations(serviceId);

      for (const si of serviceIntegrations) {
        const existingIndex = contexts.findIndex(
          (c) => c.connectionId === si.connectionId,
        );

        let serviceOverrides: Record<string, unknown> | undefined;
        if (si.config) {
          try {
            serviceOverrides = JSON.parse(si.config) as Record<string, unknown>;
          } catch {
            this.logger.warn(
              `Invalid JSON in service integration config: ${si.id}`,
            );
          }
        }

        if (existingIndex >= 0) {
          contexts[existingIndex].serviceOverrides = serviceOverrides;
        } else {
          const credentials = this.credentialsService.decrypt<
            Record<string, unknown>
          >(Buffer.from(si.connection.credentialsEnc));
          const config = si.connection.connectionConfigEnc
            ? this.credentialsService.decrypt<Record<string, unknown>>(
                Buffer.from(si.connection.connectionConfigEnc),
              )
            : {};

          contexts.push({
            type:
              this.getGitProviderName(si.connection.integration.templateId) ??
              si.connection.integration.templateId,
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

  async getIntegrationsByConnectionIds(
    connectionIds: string[],
  ): Promise<IntegrationContext[]> {
    if (connectionIds.length === 0) return [];

    const connections = await this.prisma.connection.findMany({
      where: {
        id: { in: connectionIds },
        status: 'ACTIVE',
      },
      include: { integration: true },
    });

    return connections.map((conn) => {
      const credentials = this.credentialsService.decrypt<
        Record<string, unknown>
      >(Buffer.from(conn.credentialsEnc));
      const config = conn.connectionConfigEnc
        ? this.credentialsService.decrypt<Record<string, unknown>>(
            Buffer.from(conn.connectionConfigEnc),
          )
        : {};

      return {
        type:
          this.getGitProviderName(conn.integration.templateId) ??
          conn.integration.templateId,
        connectionId: conn.id,
        credentials,
        config,
      };
    });
  }
}
