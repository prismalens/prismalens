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
  AuthManager,
  GitHubAppFlow,
  type AuthTemplate,
  type AuthManagerDeps,
  type GitHubInstallation,
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
  private authManager: AuthManager | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialsService: CredentialsService,
  ) {}

  private getAuthManager(): AuthManager {
    if (this.authManager) return this.authManager;

    const vault = this.credentialsService.getVault();
    const prisma = this.prisma;
    const credentialsService = this.credentialsService;

    const deps: AuthManagerDeps = {
      getConnection: async (connectionId: string) => {
        const conn = await prisma.connection.findUnique({
          where: { id: connectionId },
          include: { integration: true },
        });
        if (!conn) return null;
        return {
          id: conn.id,
          integrationId: conn.integrationId,
          credentialsEnc: Buffer.from(conn.credentialsEnc),
          tokenExpiresAt: conn.tokenExpiresAt,
        };
      },
      getTemplate: async (integrationId: string) => {
        const integration = await prisma.integration.findUnique({
          where: { id: integrationId },
        });
        if (!integration) return null;
        const template = getTemplate(integration.templateId);
        if (!template) return null;
        const clientId = integration.clientIdEnc
          ? vault.decrypt(Buffer.from(integration.clientIdEnc))
          : '';
        const clientSecret = integration.clientSecretEnc
          ? vault.decrypt(Buffer.from(integration.clientSecretEnc))
          : '';
        return { template, clientId, clientSecret };
      },
      updateConnectionTokens: async (connectionId, data) => {
        await prisma.connection.update({
          where: { id: connectionId },
          data: {
            credentialsEnc: new Uint8Array(
              data.credentialsEnc,
            ) as Uint8Array<ArrayBuffer>,
            tokenExpiresAt: data.tokenExpiresAt,
            lastRefreshedAt: data.lastRefreshedAt,
            status: data.status,
            consecutiveErrors: data.consecutiveErrors,
          },
        });
      },
      markConnectionError: async (connectionId, error, status) => {
        await prisma.connection.update({
          where: { id: connectionId },
          data: {
            status,
            lastErrorMessage: error,
            lastErrorAt: new Date(),
            consecutiveErrors: { increment: 1 },
          },
        });
      },
      getTemplateForConnection: async (connectionId: string) => {
        const conn = await prisma.connection.findUnique({
          where: { id: connectionId },
          include: { integration: true },
        });
        if (!conn) return null;
        return getTemplate(conn.integration.templateId) ?? null;
      },
      getConnectionCredentials: async (connectionId: string) => {
        const conn = await prisma.connection.findUnique({
          where: { id: connectionId },
        });
        if (!conn) return null;
        return credentialsService.decrypt<Record<string, unknown>>(
          Buffer.from(conn.credentialsEnc),
        );
      },
    };

    this.authManager = new AuthManager(vault, deps);
    return this.authManager;
  }

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

    let clientIdEnc: Uint8Array<ArrayBuffer> | null = null;
    let clientSecretEnc: Uint8Array<ArrayBuffer> | null = null;

    if (template.authMode === 'github_app') {
      // For GitHub App: appId → clientIdEnc, { privateKey, webhookSecret } → clientSecretEnc
      // clientId/clientSecret are plain strings — use vault.encrypt directly
      // (not encryptJSON, which would double-serialize the already-JSON clientSecret)
      const vault = this.credentialsService.getVault();
      if (dto.clientId) {
        clientIdEnc = new Uint8Array(
          vault.encrypt(dto.clientId),
        ) as Uint8Array<ArrayBuffer>;
      }
      if (dto.clientSecret) {
        clientSecretEnc = new Uint8Array(
          vault.encrypt(dto.clientSecret),
        ) as Uint8Array<ArrayBuffer>;
      }
    } else {
      clientIdEnc = dto.clientId
        ? this.credentialsService.encrypt(dto.clientId)
        : null;
      clientSecretEnc = dto.clientSecret
        ? this.credentialsService.encrypt(dto.clientSecret)
        : null;
    }

    return this.prisma.integration.create({
      data: {
        templateId: dto.templateId,
        templateVersion: template.version,
        label: dto.label,
        clientIdEnc,
        clientSecretEnc,
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

    try {
      const testResult = await this.getAuthManager().verifyConnection(id);

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
      const rawMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorMessage = rawMessage.slice(0, 500);
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

  // =========================================================================
  // TOKEN RESOLUTION (auth-mode-aware)
  // =========================================================================

  async resolveAccessToken(
    connectionId: string,
    userId?: string,
  ): Promise<string> {
    // Verify user has access to this connection
    if (userId) {
      const connection = await this.findConnectionById(connectionId, userId);
      if (!connection) {
        throw new NotFoundException('Connection not found');
      }
    }

    return this.getAuthManager().resolveAccessToken(connectionId);
  }

  // =========================================================================
  // GITHUB APP OPERATIONS
  // =========================================================================

  async listGitHubInstallations(
    integrationId: string,
  ): Promise<GitHubInstallation[]> {
    const integration = await this.findIntegrationById(integrationId);
    if (!integration) {
      throw new NotFoundException('Integration not found');
    }

    const { appId, privateKey } = this.getGitHubAppCredentials(integration);

    const jwt = GitHubAppFlow.generateJWT(appId, privateKey);
    return GitHubAppFlow.listInstallations(jwt);
  }

  async connectGitHubInstallation(
    integrationId: string,
    installationId: string,
    userId: string,
    organization?: string,
    permissionOverrides?: Record<string, string>,
  ): Promise<Connection> {
    const integration = await this.findIntegrationById(integrationId);
    if (!integration) {
      throw new NotFoundException('Integration not found');
    }

    const template = getTemplate(integration.templateId);
    if (!template || template.authMode !== 'github_app') {
      throw new BadRequestException(
        'Integration is not a GitHub App integration',
      );
    }

    const { appId, privateKey } = this.getGitHubAppCredentials(integration);

    // Generate first installation token
    const jwt = GitHubAppFlow.generateJWT(appId, privateKey);
    const permissions =
      permissionOverrides ?? template.githubApp?.defaultPermissions;

    const tokenResult = await GitHubAppFlow.getInstallationToken(
      jwt,
      installationId,
      permissions,
    );

    const credentials: Record<string, unknown> = {
      installationId,
      accessToken: tokenResult.token,
      installationToken: tokenResult.token,
      permissions: tokenResult.permissions,
      repositorySelection: tokenResult.repositorySelection,
    };
    if (permissionOverrides) {
      credentials.permissionOverrides = permissionOverrides;
    }

    const connectionConfig: Record<string, string> = {};
    if (organization) {
      connectionConfig.organization = organization;
    }

    return this.prisma.connection.create({
      data: {
        integrationId,
        userId,
        credentialsEnc: this.credentialsService.encrypt(credentials),
        connectionConfigEnc:
          Object.keys(connectionConfig).length > 0
            ? this.credentialsService.encrypt(connectionConfig)
            : null,
        tokenExpiresAt: tokenResult.expiresAt,
        lastRefreshedAt: new Date(),
        status: 'ACTIVE',
      },
    });
  }

  private getGitHubAppCredentials(integration: Integration): {
    appId: string;
    privateKey: string;
    webhookSecret?: string;
  } {
    const vault = this.credentialsService.getVault();
    if (!integration.clientIdEnc || !integration.clientSecretEnc) {
      throw new BadRequestException(
        'Integration does not have GitHub App credentials configured',
      );
    }
    const appId = vault.decrypt(Buffer.from(integration.clientIdEnc));
    const secretJson = vault.decrypt(Buffer.from(integration.clientSecretEnc));

    // clientSecret stores JSON string of { privateKey, webhookSecret }
    let parsed: { privateKey: string; webhookSecret?: string };
    try {
      parsed = JSON.parse(secretJson) as {
        privateKey: string;
        webhookSecret?: string;
      };
    } catch {
      // Fallback: if stored as raw string, treat entire value as privateKey
      parsed = { privateKey: secretJson };
    }

    return { appId, ...parsed };
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

    const accessToken = await this.resolveAccessToken(connectionId, userId);
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

    const accessToken = await this.resolveAccessToken(connectionId, userId);
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
    // github-app, github-token → github
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
      take: 1000,
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
      const template = getTemplate(conn.integration.templateId);
      let credentials: Record<string, unknown>;

      // For GitHub App, resolve a fresh installation token
      if (template?.authMode === 'github_app') {
        try {
          const token = await this.resolveAccessToken(conn.id);
          credentials = { accessToken: token };
        } catch (error) {
          this.logger.warn(
            `Failed to resolve token for connection ${conn.id}: ${error instanceof Error ? error.message : 'Unknown'}`,
          );
          continue;
        }
      } else {
        credentials = this.credentialsService.decrypt<Record<string, unknown>>(
          Buffer.from(conn.credentialsEnc),
        );
      }

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
          contexts[existingIndex] = {
            ...contexts[existingIndex],
            serviceOverrides,
          };
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
