import { Controller, Logger } from '@nestjs/common';
import {
  Implement,
  implement,
  ORPCError,
  type ORPCGlobalContext,
} from '@orpc/nest';
import { integrationsContract } from '@prismalens/contracts';
import type {
  AuthTemplateResponse,
  Connection as ConnectionResponse,
  ConnectionWithIntegration as ConnectionWithIntegrationResponse,
  Integration as IntegrationResponse,
  ServiceIntegration as ServiceIntegrationResponse,
} from '@prismalens/contracts/schemas';
import type {
  Connection,
  Integration,
  ServiceIntegration,
} from '@prismalens/database';
import { type AuthTemplate, getTemplate } from '@prismalens/integrations';
import type { ConnectionWithIntegration } from './integrations.service.js';
import { IntegrationsService } from './integrations.service.js';

@Controller()
export class IntegrationsController {
  private readonly logger = new Logger(IntegrationsController.name);

  constructor(private readonly integrationsService: IntegrationsService) {}

  private extractUserId(context: ORPCGlobalContext): string {
    const userId = context.request.user?.id;
    if (!userId) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'Authentication required',
      });
    }
    return userId;
  }

  @Implement(integrationsContract)
  integrations() {
    return {
      // =========================================================================
      // TEMPLATES
      // =========================================================================

      listTemplates: implement(integrationsContract.listTemplates).handler(
        async () => {
          const templates = this.integrationsService.findAllTemplates();
          return templates.map((t) => this.serializeTemplate(t));
        },
      ),

      getTemplate: implement(integrationsContract.getTemplate).handler(
        async ({ input }) => {
          const template = this.integrationsService.findTemplateById(input.id);
          if (!template) {
            throw new ORPCError('NOT_FOUND', {
              message: `Template ${input.id} not found`,
            });
          }
          return this.serializeTemplate(template);
        },
      ),

      // =========================================================================
      // INTEGRATIONS (OAuth client creds / provider instances)
      // =========================================================================

      createIntegration: implement(
        integrationsContract.createIntegration,
      ).handler(async ({ input }) => {
        const integration =
          await this.integrationsService.createIntegration(input);
        this.logger.log(`Created integration: ${integration.id}`);
        return this.serializeIntegration(integration);
      }),

      listIntegrations: implement(
        integrationsContract.listIntegrations,
      ).handler(async ({ input }) => {
        const integrations = await this.integrationsService.findAllIntegrations(
          {
            templateId: input.templateId,
          },
        );
        return integrations.map((i) => this.serializeIntegration(i));
      }),

      getIntegration: implement(integrationsContract.getIntegration).handler(
        async ({ input }) => {
          const integration =
            await this.integrationsService.findIntegrationById(input.id);
          if (!integration) {
            throw new ORPCError('NOT_FOUND', {
              message: `Integration ${input.id} not found`,
            });
          }
          return this.serializeIntegration(integration);
        },
      ),

      updateIntegration: implement(
        integrationsContract.updateIntegration,
      ).handler(async ({ input }) => {
        const { id, ...updateData } = input;
        const integration = await this.integrationsService.updateIntegration(
          id,
          updateData,
        );
        if (!integration) {
          throw new ORPCError('NOT_FOUND', {
            message: 'Integration not found',
          });
        }
        this.logger.log(`Updated integration: ${id}`);
        return this.serializeIntegration(integration);
      }),

      deleteIntegration: implement(
        integrationsContract.deleteIntegration,
      ).handler(async ({ input }) => {
        const deleted = await this.integrationsService.deleteIntegration(
          input.id,
        );
        if (!deleted) {
          throw new ORPCError('NOT_FOUND', {
            message: 'Integration not found',
          });
        }
        this.logger.log(`Deleted integration: ${input.id}`);
      }),

      // =========================================================================
      // CONNECTIONS (user tokens / API keys)
      // =========================================================================

      createConnection: implement(
        integrationsContract.createConnection,
      ).handler(async ({ input, context }) => {
        const userId = this.extractUserId(context);
        const connection = await this.integrationsService.createConnection(
          input,
          userId,
        );
        this.logger.log(`Created connection: ${connection.id}`);
        return this.serializeConnection(connection);
      }),

      listConnections: implement(integrationsContract.listConnections).handler(
        async ({ input, context }) => {
          const userId = this.extractUserId(context);
          const connections = await this.integrationsService.findAllConnections(
            {
              status: input.status,
              userId,
            },
          );
          return connections.map((c) =>
            this.serializeConnectionWithIntegration(c),
          );
        },
      ),

      getConnection: implement(integrationsContract.getConnection).handler(
        async ({ input, context }) => {
          const userId = this.extractUserId(context);
          const connection = await this.integrationsService.findConnectionById(
            input.id,
            userId,
          );
          if (!connection) {
            throw new ORPCError('NOT_FOUND', {
              message: 'Connection not found',
            });
          }
          return this.serializeConnectionWithIntegration(connection);
        },
      ),

      updateConnection: implement(
        integrationsContract.updateConnection,
      ).handler(async ({ input, context }) => {
        const userId = this.extractUserId(context);
        const { id, ...updateData } = input;
        const connection = await this.integrationsService.updateConnection(
          id,
          updateData,
          userId,
        );
        if (!connection) {
          throw new ORPCError('NOT_FOUND', {
            message: 'Connection not found',
          });
        }
        this.logger.log(`Updated connection: ${id}`);
        return this.serializeConnection(connection);
      }),

      deleteConnection: implement(
        integrationsContract.deleteConnection,
      ).handler(async ({ input, context }) => {
        const userId = this.extractUserId(context);
        const deleted = await this.integrationsService.deleteConnection(
          input.id,
          userId,
        );
        if (!deleted) {
          throw new ORPCError('NOT_FOUND', {
            message: 'Connection not found',
          });
        }
        this.logger.log(`Deleted connection: ${input.id}`);
      }),

      testConnection: implement(integrationsContract.testConnection).handler(
        async ({ input, context }) => {
          const userId = this.extractUserId(context);
          const result = await this.integrationsService.testConnection(
            input.id,
            userId,
          );
          return { success: result.success };
        },
      ),

      // =========================================================================
      // GIT PROVIDER ENDPOINTS
      // =========================================================================

      getGitOrganizations: implement(
        integrationsContract.getGitOrganizations,
      ).handler(async ({ input, context }) => {
        const userId = this.extractUserId(context);
        return this.integrationsService.getGitOrganizations(input.id, userId);
      }),

      getGitRepositories: implement(
        integrationsContract.getGitRepositories,
      ).handler(async ({ input, context }) => {
        const userId = this.extractUserId(context);
        return this.integrationsService.getGitRepositories(
          input.id,
          input.org,
          userId,
        );
      }),

      updateConnectionConfig: implement(
        integrationsContract.updateConnectionConfig,
      ).handler(async ({ input, context }) => {
        const userId = this.extractUserId(context);
        const connection =
          await this.integrationsService.updateConnectionConfig(
            input.id,
            input.config,
            userId,
          );
        this.logger.log(`Updated config for connection: ${input.id}`);
        return this.serializeConnection(connection);
      }),

      // =========================================================================
      // SERVICE INTEGRATION ENDPOINTS
      // =========================================================================

      getServiceIntegrations: implement(
        integrationsContract.getServiceIntegrations,
      ).handler(async ({ input }) => {
        return this.integrationsService.getServiceIntegrationsWithStatus(
          input.serviceId,
        );
      }),

      createServiceIntegration: implement(
        integrationsContract.createServiceIntegration,
      ).handler(async ({ input }) => {
        const serviceIntegration =
          await this.integrationsService.createServiceIntegration(input);
        this.logger.log(
          `Created service integration: ${serviceIntegration.id}`,
        );
        return this.serializeServiceIntegration(serviceIntegration);
      }),

      updateServiceIntegration: implement(
        integrationsContract.updateServiceIntegration,
      ).handler(async ({ input }) => {
        const { id, ...updateData } = input;
        const serviceIntegration =
          await this.integrationsService.updateServiceIntegrationById(
            id,
            updateData,
          );
        if (!serviceIntegration) {
          throw new ORPCError('NOT_FOUND', {
            message: 'Service integration not found',
          });
        }
        this.logger.log(`Updated service integration: ${id}`);
        return this.serializeServiceIntegration(serviceIntegration);
      }),

      deleteServiceIntegration: implement(
        integrationsContract.deleteServiceIntegration,
      ).handler(async ({ input }) => {
        const deleted =
          await this.integrationsService.deleteServiceIntegrationById(input.id);
        if (!deleted) {
          throw new ORPCError('NOT_FOUND', {
            message: 'Service integration not found',
          });
        }
        this.logger.log(`Deleted service integration: ${input.id}`);
      }),
    };
  }

  private serializeTemplate(template: AuthTemplate): AuthTemplateResponse {
    return {
      id: template.id,
      name: template.name,
      category: template.category,
      authMode: template.authMode,
      icon: template.icon,
      docsUrl: template.docsUrl,
      connectionFields: template.connectionFields as
        | AuthTemplateResponse['connectionFields']
        | undefined,
      credentialFields: template.credentialFields as
        | AuthTemplateResponse['credentialFields']
        | undefined,
      hasOAuth: template.authMode === 'oauth2',
    };
  }

  private serializeIntegration(integration: Integration): IntegrationResponse {
    return {
      id: integration.id,
      templateId: integration.templateId,
      label: integration.label,
      scopes: this.parseStringArray(integration.scopes),
      callbackUrl: integration.callbackUrl ?? null,
      enabled: integration.enabled,
      createdAt: integration.createdAt.toISOString(),
      updatedAt: integration.updatedAt.toISOString(),
    };
  }

  private serializeConnection(connection: Connection): ConnectionResponse {
    return {
      id: connection.id,
      integrationId: connection.integrationId,
      userId: connection.userId,
      status: connection.status as ConnectionResponse['status'],
      tokenExpiresAt: connection.tokenExpiresAt?.toISOString() ?? null,
      grantedScopes: this.parseStringArray(connection.grantedScopes),
      lastUsedAt: connection.lastUsedAt?.toISOString() ?? null,
      lastRefreshedAt: connection.lastRefreshedAt?.toISOString() ?? null,
      lastErrorMessage: connection.lastErrorMessage
        ? 'Connection error occurred. Check logs for details.'
        : null,
      lastErrorAt: connection.lastErrorAt?.toISOString() ?? null,
      consecutiveErrors: connection.consecutiveErrors ?? 0,
      createdAt: connection.createdAt.toISOString(),
      updatedAt: connection.updatedAt.toISOString(),
    };
  }

  private serializeConnectionWithIntegration(
    connection: ConnectionWithIntegration,
  ): ConnectionWithIntegrationResponse {
    const serialized = this.serializeConnection(connection);
    const { integration } = connection;

    return {
      ...serialized,
      integration: this.serializeIntegration(integration),
      templateId: integration.templateId,
      templateName:
        getTemplate(integration.templateId)?.name ?? integration.templateId,
    };
  }

  private serializeServiceIntegration(
    si: ServiceIntegration,
  ): ServiceIntegrationResponse {
    return {
      id: si.id,
      serviceId: si.serviceId,
      connectionId: si.connectionId,
      priority: si.priority ?? 0,
      config: si.config ? this.safeParseJson(si.config) : null,
      isEnabled: si.isEnabled,
      createdAt: si.createdAt.toISOString(),
      updatedAt: si.updatedAt.toISOString(),
    };
  }

  private parseStringArray(value: string | string[] | null): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
      return JSON.parse(value) as string[];
    } catch {
      return [];
    }
  }

  private safeParseJson(value: string): Record<string, unknown> | null {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      this.logger.warn('Failed to parse JSON config');
      return null;
    }
  }
}
