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
import {
  createDeploymentProvider,
  getTemplate,
  resolveDeploymentProviderName,
  resolveGitProviderName,
} from '@prismalens/integrations';
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

type ConnectionWithTemplate = Connection & {
  integration: { templateId: string };
};

@Injectable()
export class ServiceDiscoveryService {
  private readonly logger = new Logger(ServiceDiscoveryService.name);

  /** Strategy dispatch map — keyed by template category */
  private readonly discoveryStrategies: Record<
    string,
    (conn: ConnectionWithTemplate) => Promise<ServiceSuggestion[]>
  > = {
    vcs: (conn) => this.discoverFromVcsProvider(conn),
    deployment: (conn) => this.discoverFromDeploymentProvider(conn),
  };

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
    if (!template) {
      throw new BadRequestException('Template not found for this connection');
    }

    const strategy = this.discoveryStrategies[template.category];
    if (!strategy) {
      throw new BadRequestException(
        `Discovery not supported for category "${template.category}"`,
      );
    }

    return strategy(connection);
  }

  // =========================================================================
  // VCS DISCOVERY (existing flow, renamed from discoverFromProvider)
  // =========================================================================

  async discoverFromVcsProvider(
    connection: ConnectionWithTemplate,
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

    const config = connection.connectionConfigEnc
      ? this.credentialsService.decrypt<Record<string, unknown>>(
          Buffer.from(connection.connectionConfigEnc),
        )
      : {};

    const allRepositories = config.allRepositories as boolean | undefined;
    const configuredRepos = (config.repositories || []) as string[];
    const organization = config.organization as string | undefined;

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

          const suggestion = await this.upsertSuggestion({
            connectionId: connection.id,
            suggestedName: service.name,
            repository: repo,
            isMonorepo,
            subPath,
            sourceType: 'repository',
            providerName,
          });
          suggestions.push(suggestion);
        }
      } catch (error) {
        this.logger.error(`Error discovering services from ${repo}:`, error);
      }
    }

    return suggestions;
  }

  // =========================================================================
  // DEPLOYMENT DISCOVERY (new flow)
  // =========================================================================

  async discoverFromDeploymentProvider(
    connection: ConnectionWithTemplate,
  ): Promise<ServiceSuggestion[]> {
    const providerName = resolveDeploymentProviderName(
      connection.integration.templateId,
    );

    if (!providerName) {
      throw new BadRequestException(
        `Deployment discovery not supported for provider "${connection.integration.templateId}"`,
      );
    }

    this.logger.log(
      `Discovering deployments from ${providerName} connection: ${connection.id}`,
    );

    const provider = createDeploymentProvider(providerName);
    if (!provider) {
      throw new BadRequestException(
        `Failed to create deployment provider: ${providerName}`,
      );
    }

    const requestFn = this.integrationsService.createRequestFn(connection.id);
    const deploymentServices = await provider.listServices(requestFn);

    const suggestions: ServiceSuggestion[] = [];

    for (const svc of deploymentServices) {
      try {
        const suggestion = await this.upsertSuggestion({
          connectionId: connection.id,
          suggestedName: svc.name,
          repository: svc.name, // Use service name as identifier for deployments
          isMonorepo: false,
          subPath: null,
          sourceType: 'deployment',
          providerName,
          metadata: {
            externalId: svc.id,
            type: svc.type,
            status: svc.status,
            url: svc.url,
            repo: svc.repo,
            branch: svc.branch,
            region: svc.region,
            project: svc.project,
            environment: svc.environment,
            dependencies: svc.dependencies,
          },
        });
        suggestions.push(suggestion);
      } catch (error) {
        this.logger.error(
          `Error creating suggestion for deployment ${svc.name}:`,
          error,
        );
      }
    }

    return suggestions;
  }

  // =========================================================================
  // SUGGESTION UPSERT HELPER
  // =========================================================================

  private async upsertSuggestion(params: {
    connectionId: string;
    suggestedName: string;
    repository: string;
    isMonorepo: boolean;
    subPath: string | null;
    sourceType: string;
    providerName: string;
    metadata?: Record<string, unknown>;
  }): Promise<ServiceSuggestion> {
    const existing = await this.prisma.serviceSuggestion.findFirst({
      where: {
        connectionId: params.connectionId,
        repository: params.repository,
        subPath: params.subPath,
      },
    });

    if (
      existing &&
      existing.status !== 'rejected' &&
      existing.status !== 'ignored'
    ) {
      return this.prisma.serviceSuggestion.update({
        where: { id: existing.id },
        data: { updatedAt: new Date() },
      });
    }

    const createData: Record<string, unknown> = {
      connectionId: params.connectionId,
      suggestedName: params.suggestedName,
      displayName: params.suggestedName.replace(/-/g, ' '),
      repository: params.repository,
      isMonorepo: params.isMonorepo,
      sourceType: params.sourceType,
      status: 'pending',
      metadata: JSON.stringify({
        discoveryMethod: params.providerName,
        discoveredAt: new Date().toISOString(),
        ...params.metadata,
      }),
    };

    if (params.subPath !== null) {
      createData.subPath = params.subPath;
    }

    return this.prisma.serviceSuggestion.create({
      data: createData as Parameters<
        typeof this.prisma.serviceSuggestion.create
      >[0]['data'],
    });
  }

  /**
   * Analyze repository structure to detect monorepo layout and service boundaries.
   */
  async analyzeRepoStructure(
    repo: string,
    _connection: ConnectionWithTemplate,
  ): Promise<{
    isMonorepo: boolean;
    services: DiscoveredService[];
  }> {
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

  async getSuggestions(params: {
    connectionId?: string;
    status?: string;
    sourceType?: string;
    limit?: number;
    offset?: number;
  }): Promise<ServiceSuggestion[]> {
    const where: Record<string, unknown> = {};
    if (params.connectionId) where.connectionId = params.connectionId;
    if (params.status) where.status = params.status;
    if (params.sourceType) where.sourceType = params.sourceType;

    return this.prisma.serviceSuggestion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 50,
      skip: params.offset ?? 0,
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

    const sourceType = (suggestion as Record<string, unknown>).sourceType as
      | string
      | undefined;

    if (sourceType === 'deployment') {
      return this.acceptDeploymentSuggestion(suggestion, overrides);
    }

    return this.acceptRepositorySuggestion(suggestion, overrides);
  }

  // =========================================================================
  // ACCEPT FLOWS BY SOURCE TYPE
  // =========================================================================

  private async acceptRepositorySuggestion(
    suggestion: ServiceSuggestion,
    overrides?: AcceptSuggestionDto,
  ): Promise<Service> {
    const serviceName = overrides?.name || suggestion.suggestedName;

    // Create repository record + service + link them
    const [service] = await this.prisma.$transaction([
      this.prisma.service.create({
        data: {
          name: serviceName,
          displayName:
            overrides?.displayName || suggestion.displayName || serviceName,
          description: overrides?.description,
          type: overrides?.type || 'service',
          team: overrides?.team,
        },
      }),
      this.prisma.serviceSuggestion.update({
        where: { id: suggestion.id },
        data: { status: 'accepted' },
      }),
    ]);

    this.logger.log(
      `Accepted repository suggestion: ${serviceName} (${service.id})`,
    );

    return service;
  }

  private async acceptDeploymentSuggestion(
    suggestion: ServiceSuggestion,
    overrides?: AcceptSuggestionDto,
  ): Promise<Service> {
    const serviceName = overrides?.name || suggestion.suggestedName;

    let metadata: Record<string, unknown> = {};
    try {
      metadata =
        typeof suggestion.metadata === 'string'
          ? (JSON.parse(suggestion.metadata) as Record<string, unknown>)
          : ((suggestion.metadata as unknown as Record<string, unknown>) ?? {});
    } catch {
      // ignore parse errors
    }

    // Validate linked service exists before starting transaction
    if (overrides?.linkedServiceId) {
      const existing = await this.prisma.service.findUnique({
        where: { id: overrides.linkedServiceId },
      });
      if (!existing) {
        throw new NotFoundException('Linked service not found');
      }
    }

    // Atomic: create/link service + deployment + mark accepted
    const service = await this.prisma.$transaction(async (tx) => {
      let svc: Service;
      if (overrides?.linkedServiceId) {
        svc = (await tx.service.findUnique({
          where: { id: overrides.linkedServiceId },
        }))!;
      } else {
        svc = await tx.service.create({
          data: {
            name: serviceName,
            displayName:
              overrides?.displayName || suggestion.displayName || serviceName,
            description: overrides?.description,
            type: overrides?.type || 'service',
            team: overrides?.team,
          },
        });
      }

      if (metadata.externalId) {
        await tx.deployment.create({
          data: {
            serviceId: svc.id,
            connectionId: suggestion.connectionId,
            externalId: metadata.externalId as string,
            name: suggestion.suggestedName,
            url: (metadata.url as string) ?? null,
            status: (metadata.status as string) ?? null,
            deploymentType: (metadata.type as string) ?? null,
            region: (metadata.region as string) ?? null,
            branch: (metadata.branch as string) ?? null,
            repositoryUrl: (metadata.repo as string) ?? null,
            environment: (metadata.environment as string) ?? null,
            metadata: metadata.project
              ? JSON.stringify({ project: metadata.project })
              : undefined,
          },
        });
      }

      // Auto-link repository if the deployment has a repo reference
      if (metadata.repo) {
        await this.tryAutoLinkRepository(tx, svc.id, metadata.repo as string);
      }

      // Auto-create dependencies if the provider reported them
      if (
        Array.isArray(metadata.dependencies) &&
        metadata.dependencies.length > 0
      ) {
        await this.tryAutoCreateDependencies(
          tx,
          svc.id,
          metadata.dependencies as string[],
        );
      }

      await tx.serviceSuggestion.update({
        where: { id: suggestion.id },
        data: { status: 'accepted' },
      });

      return svc;
    });

    this.logger.log(
      `Accepted deployment suggestion: ${serviceName} (${service.id})`,
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

  // =========================================================================
  // AUTO-LINKING HELPERS
  // =========================================================================

  /**
   * Best-effort: link a repository to a service if a matching Repository record exists.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma transaction client type
  private async tryAutoLinkRepository(
    tx: any,
    serviceId: string,
    repoRef: string,
  ): Promise<void> {
    try {
      // Extract "org/repo" from full URLs like "https://github.com/org/repo.git"
      const fullName = repoRef
        .replace(/^https?:\/\/[^/]+\//, '')
        .replace(/\.git$/, '');

      const existingRepo = await tx.repository.findFirst({
        where: {
          OR: [{ url: repoRef }, { fullName }],
        },
      });

      if (!existingRepo) return;

      // Check if already linked
      const existingLink = await tx.serviceRepository.findFirst({
        where: { serviceId, repositoryId: existingRepo.id },
      });

      if (existingLink) return;

      await tx.serviceRepository.create({
        data: {
          serviceId,
          repositoryId: existingRepo.id,
          isPrimary: true,
        },
      });

      this.logger.log(
        `Auto-linked repository ${fullName} to service ${serviceId}`,
      );
    } catch (error) {
      this.logger.warn('Failed to auto-link repository (non-blocking):', error);
    }
  }

  /**
   * Best-effort: create ServiceDependency records for dependency names
   * that match existing services.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma transaction client type
  private async tryAutoCreateDependencies(
    tx: any,
    serviceId: string,
    dependencyNames: string[],
  ): Promise<void> {
    try {
      // Batch lookup: find all matching services in one query
      const matchingServices = await tx.service.findMany({
        where: {
          OR: dependencyNames.flatMap((name) => [
            { name },
            { displayName: name },
          ]),
        },
        select: { id: true, name: true },
      });

      if (matchingServices.length === 0) return;

      // Batch lookup: find existing dependencies in one query
      const candidateIds = matchingServices
        .filter((s: { id: string }) => s.id !== serviceId)
        .map((s: { id: string }) => s.id);

      if (candidateIds.length === 0) return;

      const existingDeps = await tx.serviceDependency.findMany({
        where: {
          dependentId: serviceId,
          dependencyId: { in: candidateIds },
        },
        select: { dependencyId: true },
      });

      const existingDepIds = new Set(
        existingDeps.map((d: { dependencyId: string }) => d.dependencyId),
      );

      // Create only new dependencies
      for (const svc of matchingServices) {
        if (svc.id === serviceId || existingDepIds.has(svc.id)) continue;

        await tx.serviceDependency.create({
          data: {
            dependentId: serviceId,
            dependencyId: svc.id,
            dependencyType: 'runtime',
            criticality: 'required',
          },
        });

        this.logger.log(`Auto-created dependency: ${serviceId} -> ${svc.name}`);
      }
    } catch (error) {
      this.logger.warn(
        'Failed to auto-create dependencies (non-blocking):',
        error,
      );
    }
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
