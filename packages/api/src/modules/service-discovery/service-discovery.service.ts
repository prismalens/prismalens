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
import { getTemplate } from '@prismalens/integrations';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { CredentialsService } from '../integrations/crypto/credentials.service.js';
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

    const providerName = connection.integration.templateId.replace(
      /-oauth2$|-token$/,
      '',
    );

    if (providerName === 'github') {
      return this.discoverFromGitHub(connection);
    }

    throw new BadRequestException(
      `Service discovery not yet implemented for "${providerName}"`,
    );
  }

  async discoverFromGitHub(
    connection: Connection,
  ): Promise<ServiceSuggestion[]> {
    this.logger.log(
      `Discovering services from GitHub connection: ${connection.id}`,
    );

    const config = connection.connectionConfigEnc
      ? this.credentialsService.decrypt<Record<string, unknown>>(
          Buffer.from(connection.connectionConfigEnc),
        )
      : {};
    const repositories = (config.repositories || []) as string[];

    if (repositories.length === 0) {
      this.logger.warn('No repositories configured for GitHub connection');
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
                discoveryMethod: 'github',
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

  // TODO: Implement actual repo analysis (currently returns a stub)
  async analyzeRepoStructure(
    repo: string,
    _connection: Connection,
  ): Promise<{
    isMonorepo: boolean;
    services: DiscoveredService[];
  }> {
    this.logger.warn(
      `analyzeRepoStructure is a stub — returning single-service default for: ${repo}`,
    );

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
          discoverySource: 'github',
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

  async rejectSuggestion(suggestionId: string): Promise<void> {
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

    await this.prisma.serviceSuggestion.update({
      where: { id: suggestionId },
      data: { status: 'rejected' },
    });

    this.logger.log(`Rejected service suggestion: ${suggestionId}`);
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
}
