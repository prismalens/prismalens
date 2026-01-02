import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  NotFoundException,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { IntegrationsService } from './integrations.service.js';
import {
  CreateConnectionDto,
  UpdateConnectionDto,
  UpdateOAuthConfigDto,
  CreateServiceIntegrationDto,
} from './dto/index.js';

@Controller('integrations')
export class IntegrationsController {
  private readonly logger = new Logger(IntegrationsController.name);

  constructor(private readonly integrationsService: IntegrationsService) {}

  // =========================================================================
  // INTEGRATION DEFINITIONS (Catalog)
  // =========================================================================

  @Get('definitions')
  async getDefinitions() {
    const definitions = await this.integrationsService.findAllDefinitions();
    return { definitions };
  }

  @Get('definitions/:name')
  async getDefinition(@Param('name') name: string) {
    const definition = await this.integrationsService.findDefinitionByName(name);
    if (!definition) {
      throw new NotFoundException(`Integration '${name}' not found`);
    }
    return { definition };
  }

  @Patch('definitions/:name/oauth')
  async updateOAuthConfig(
    @Param('name') name: string,
    @Body() dto: UpdateOAuthConfigDto,
  ) {
    const definition = await this.integrationsService.updateOAuthConfig(name, dto);
    this.logger.log(`Updated OAuth config for integration: ${name}`);
    return { definition, message: 'OAuth configuration updated successfully' };
  }

  // =========================================================================
  // INTEGRATION CONNECTIONS (User Instances)
  // =========================================================================

  @Post('connections')
  @HttpCode(HttpStatus.CREATED)
  async createConnection(@Body() dto: CreateConnectionDto) {
    const connection = await this.integrationsService.createConnection(dto);
    this.logger.log(`Created integration connection: ${connection.id}`);
    return { connection };
  }

  @Get('connections')
  async getConnections(
    @Query('status') status?: string,
    @Query('definitionId') definitionId?: string,
    @Query('global') globalParam?: string,
  ) {
    const isGlobal =
      globalParam === 'true' ? true : globalParam === 'false' ? false : undefined;

    const connections = await this.integrationsService.findAllConnections({
      status,
      definitionId,
      isGlobal,
    });

    // Mask credentials for API response
    const safeConnections = connections.map((conn) => ({
      ...conn,
      credentials: '[ENCRYPTED]',
    }));

    return { connections: safeConnections };
  }

  @Get('connections/:id')
  async getConnection(@Param('id') id: string) {
    const connection =
      await this.integrationsService.getConnectionWithMaskedCredentials(id);
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }

    return {
      connection: {
        ...connection,
        credentials: connection.maskedCredentials,
      },
    };
  }

  @Patch('connections/:id')
  async updateConnection(
    @Param('id') id: string,
    @Body() dto: UpdateConnectionDto,
  ) {
    const connection = await this.integrationsService.updateConnection(id, dto);
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }
    this.logger.log(`Updated integration connection: ${id}`);
    return { connection };
  }

  @Delete('connections/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConnection(@Param('id') id: string) {
    const deleted = await this.integrationsService.deleteConnection(id);
    if (!deleted) {
      throw new NotFoundException('Connection not found');
    }
    this.logger.log(`Deleted integration connection: ${id}`);
  }

  @Post('connections/:id/test')
  async testConnection(@Param('id') id: string) {
    const result = await this.integrationsService.testConnection(id);
    return {
      success: result.success,
      error: result.error,
      message: result.success
        ? 'Connection test successful'
        : `Connection test failed: ${result.error}`,
    };
  }

  // =========================================================================
  // SERVICE INTEGRATIONS (Service-Level Mappings)
  // =========================================================================

  @Post('services/:serviceId/integrations')
  @HttpCode(HttpStatus.CREATED)
  async createServiceIntegration(
    @Param('serviceId') serviceId: string,
    @Body() dto: CreateServiceIntegrationDto,
  ) {
    const mapping = await this.integrationsService.createServiceIntegration(
      serviceId,
      dto,
    );
    this.logger.log(
      `Created service integration mapping: ${serviceId} -> ${dto.connectionId}`,
    );
    return { mapping };
  }

  @Get('services/:serviceId/integrations')
  async getServiceIntegrations(@Param('serviceId') serviceId: string) {
    const integrations =
      await this.integrationsService.findServiceIntegrations(serviceId);

    // Mask credentials
    const safeIntegrations = integrations.map((si) => ({
      ...si,
      connection: {
        ...si.connection,
        credentials: '[ENCRYPTED]',
      },
    }));

    return { integrations: safeIntegrations };
  }

  @Delete('services/:serviceId/integrations/:connectionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteServiceIntegration(
    @Param('serviceId') serviceId: string,
    @Param('connectionId') connectionId: string,
  ) {
    const deleted = await this.integrationsService.deleteServiceIntegration(
      serviceId,
      connectionId,
    );
    if (!deleted) {
      throw new NotFoundException('Service integration mapping not found');
    }
    this.logger.log(
      `Deleted service integration mapping: ${serviceId} -> ${connectionId}`,
    );
  }
}
