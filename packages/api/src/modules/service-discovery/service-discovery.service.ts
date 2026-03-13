import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Connection,
  Service,
  ServiceSuggestion,
} from '@prismalens/database';
import { getTemplate, resolveGitProviderName } from '@prismalens/integrations';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { CredentialsService } from '../integrations/crypto/credentials.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import type {
  AcceptBulkSuggestionsDto,
  AcceptSuggestionDto,
} from './dto/index.js';

export interface DiscoveredService {
  name: string;
  path: string;
  isMonorepo?: boolean;
}

@Injectable()
export class ServiceDiscoveryService {
  private readonly logger = new Logger(ServiceDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialsService: CredentialsService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  // =========================================================================
  // DISCOVERY TRIGGER
  // =========================================================================

  async discoverFromConnection(
    connectionId: string,
  ): Promise<ServiceSuggestion[]> {
    const connection = await this.prisma.connection.findUnique({
      where: { id: connectionId },
      include: { integration: true },
    });

    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    const template = getTemplate(connection.integration.templateId);
    if (!template || template.category !== 'vcs') {
      throw new BadRequestException(
        'This connection does not support service discovery',
      );
    }

    return this.discoverFromProvider(connection);
  }

  async discoverFromProvider(
    connection: Connection & { integration: { templateId: string } },
  ): Promise<ServiceSuggestion[]> {
    const providerName = resolveGitProviderName(
      connection.integration.templateId,
    );

    if (!providerName) {
      throw new BadRequestException(
        `Service discovery not supported for provider "${connection.integration.templateId}"`,
      );
    }

    this.logger.log(
      `Discovering services from ${providerName} connection: ${connection.id}`,
    );

    // Decrypt connection config to get repository settings
    const config = connection.connectionConfigEnc
      ? this.credentialsService.decrypt<Record<string, unknown>>(
          Buffer.from(connection.connectionConfigEnc),
        )
      : {};

    const allRepositories = config.allRepositories as boolean | undefined;
    const configuredRepos = (config.repositories || []) as string[];
    const organization = config.organization as string | undefined;

    // Resolve repository list — delegate to IntegrationsService for auth + capability checks
    let repositories: string[];

    if (allRepositories || configuredRepos.length === 0) {
      const remoteRepos = await this.integrationsService.getGitRepositories(
        connection.id,
        organization,
      );
      repositories = remoteRepos.map((r) => r.fullName);
    } else {
      repositories = configuredRepos;
    }

    if (repositories.length === 0) {
      this.logger.warn(
        `No repositories found for ${providerName} connection ${connection.id}`,
      );
      return [];
    }

    const suggestions: ServiceSuggestion[] = [];

    for (const repo of repositories) {
      try {
        const { isMonorepo, services } = await this.analyzeRepoStructure(
          repo,
          connection,
        );

        for (const service of services) {
          const subPath: string | null =
            service.path === '.' ? null : service.path;

          const existing = await this.prisma.serviceSuggestion.findFirst({
            where: {
              connectionId: connection.id,
              repository: repo,
              subPath,
            },
          });

          if (
            existing &&
            existing.status !== 'rejected' &&
            existing.status !== 'ignored'
          ) {
            const updated = await this.prisma.serviceSuggestion.update({
              where: { id: existing.id },
              data: { updatedAt: new Date() },
            });
            suggestions.push(updated);
          } else {
            const createData: Record<string, unknown> = {
              connectionId: connection.id,
              suggestedName: service.name,
              displayName: service.name.replace(/-/g, ' '),
              repository: repo,
              isMonorepo,
              status: 'pending',
              metadata: JSON.stringify({
                discoveryMethod: providerName,
                discoveredAt: new Date().toISOString(),
              }),
            };

            if (subPath !== null) {
              createData.subPath = subPath;
            }

            const suggestion = await this.prisma.serviceSuggestion.create({
              data: createData as Parameters<
                typeof this.prisma.serviceSuggestion.create
              >[0]['data'],
            });
            suggestions.push(suggestion);
          }
        }
      } catch (error) {
        this.logger.error(`Error discovering services from ${repo}:`, error);
      }
    }

    return suggestions;
  }

  /**
   * Analyze repository structure to detect monorepo layout and service boundaries.
   * Currently returns a single-service default — full analysis is not yet implemented.
   */
  async analyzeRepoStructure(
    repo: string,
    _connection: Connection & { integration: { templateId: string } },
  ): Promise<{
    isMonorepo: boolean;
    services: DiscoveredService[];
  }> {
    // Single-service default: assumes repo = one service.
    // Full repo analysis (monorepo detection, language scanning) is planned.
    return {
      isMonorepo: false,
      services: [
        {
          name: repo.split('/')[1] || repo,
          path: '.',
        },
      ],
    };
  }

  // =========================================================================
  // SUGGESTION MANAGEMENT
  // =========================================================================

  async getPendingSuggestions(): Promise<ServiceSuggestion[]> {
    return this.prisma.serviceSuggestion.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findSuggestionById(id: string): Promise<ServiceSuggestion | null> {
    return this.prisma.serviceSuggestion.findUnique({
      where: { id },
    });
  }

  async acceptSuggestion(
    suggestionId: string,
    overrides?: AcceptSuggestionDto,
  ): Promise<Service> {
    const suggestion = await this.prisma.serviceSuggestion.findUnique({
      where: { id: suggestionId },
    });

    if (!suggestion) {
      throw new NotFoundException('Service suggestion not found');
    }

    if (suggestion.status !== 'pending') {
      throw new BadRequestException(
        `Cannot accept suggestion with status: ${suggestion.status}`,
      );
    }

    const serviceName = overrides?.name || suggestion.suggestedName;

    // Atomic: create service + mark suggestion accepted in one transaction
    const [service] = await this.prisma.$transaction([
      this.prisma.service.create({
        data: {
          name: serviceName,
          displayName:
            overrides?.displayName || suggestion.displayName || serviceName,
          description: overrides?.description,
          type: overrides?.type || 'service',
          team: overrides?.team,
          discoverySource: this.resolveProviderFromSuggestion(suggestion),
          discoveryMetadata: JSON.stringify({
            repository: suggestion.repository,
            subPath: suggestion.subPath,
            isMonorepo: suggestion.isMonorepo,
          }),
          isDiscovered: true,
          isConfirmed: true,
        },
      }),
      this.prisma.serviceSuggestion.update({
        where: { id: suggestionId },
        data: { status: 'accepted' },
      }),
    ]);

    this.logger.log(
      `Accepted service suggestion: ${serviceName} (${service.id})`,
    );

    return service;
  }

  async ignoreSuggestion(suggestionId: string): Promise<ServiceSuggestion> {
    const suggestion = await this.prisma.serviceSuggestion.findUnique({
      where: { id: suggestionId },
    });

    if (!suggestion) {
      throw new NotFoundException('Service suggestion not found');
    }

    if (suggestion.status !== 'pending') {
      throw new BadRequestException(
        `Cannot ignore suggestion with status: ${suggestion.status}`,
      );
    }

    const updated = await this.prisma.serviceSuggestion.update({
      where: { id: suggestionId },
      data: { status: 'ignored' },
    });

    this.logger.log(`Ignored service suggestion: ${suggestionId}`);
    return updated;
  }

  async rejectSuggestion(suggestionId: string): Promise<ServiceSuggestion> {
    const suggestion = await this.prisma.serviceSuggestion.findUnique({
      where: { id: suggestionId },
    });

    if (!suggestion) {
      throw new NotFoundException('Service suggestion not found');
    }

    if (suggestion.status !== 'pending') {
      throw new BadRequestException(
        `Cannot reject suggestion with status: ${suggestion.status}`,
      );
    }

    const updated = await this.prisma.serviceSuggestion.update({
      where: { id: suggestionId },
      data: { status: 'rejected' },
    });

    this.logger.log(`Rejected service suggestion: ${suggestionId}`);
    return updated;
  }

  async acceptMultiple(
    suggestionIds: string[],
    overrides?: AcceptBulkSuggestionsDto['overrides'],
  ): Promise<Service[]> {
    const services: Service[] = [];

    for (const suggestionId of suggestionIds) {
      try {
        const service = await this.acceptSuggestion(suggestionId, {
          type: overrides?.type,
          team: overrides?.team,
        });
        services.push(service);
      } catch (error) {
        this.logger.error(`Error accepting suggestion ${suggestionId}:`, error);
      }
    }

    return services;
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  private resolveProviderFromSuggestion(suggestion: ServiceSuggestion): string {
    try {
      const metadata =
        typeof suggestion.metadata === 'string'
          ? (JSON.parse(suggestion.metadata) as Record<string, unknown>)
          : suggestion.metadata;
      const provider = (metadata?.discoveryMethod as string) ?? null;
      if (!provider) {
        this.logger.warn(
          `No discoveryMethod in metadata for suggestion ${suggestion.id}, defaulting to "vcs"`,
        );
        return 'vcs';
      }
      return provider;
    } catch (error) {
      this.logger.error(
        `Malformed metadata on suggestion ${suggestion.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 'vcs';
    }
  }
}
