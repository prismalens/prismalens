import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { ServiceDiscoveryService } from './service-discovery.service.js';
import { AcceptSuggestionDto, AcceptBulkSuggestionsDto } from './dto/index.js';

@Controller('service-discovery')
export class ServiceDiscoveryController {
  private readonly logger = new Logger(ServiceDiscoveryController.name);

  constructor(private readonly serviceDiscoveryService: ServiceDiscoveryService) {}

  /**
   * Trigger service discovery for a given integration connection.
   */
  @Post('trigger/:connectionId')
  async triggerDiscovery(@Param('connectionId') connectionId: string) {
    this.logger.log(`Triggering service discovery for connection: ${connectionId}`);
    return this.serviceDiscoveryService.discoverFromConnection(connectionId);
  }

  /**
   * Get all pending service suggestions.
   */
  @Get('suggestions')
  async getPendingSuggestions() {
    return this.serviceDiscoveryService.getPendingSuggestions();
  }

  /**
   * Accept a service suggestion and create a Service.
   */
  @Post('suggestions/:id/accept')
  async acceptSuggestion(
    @Param('id') suggestionId: string,
    @Body() dto?: AcceptSuggestionDto,
  ) {
    this.logger.log(`Accepting service suggestion: ${suggestionId}`);
    return this.serviceDiscoveryService.acceptSuggestion(suggestionId, dto);
  }

  /**
   * Reject a service suggestion.
   */
  @Post('suggestions/:id/reject')
  @HttpCode(204)
  async rejectSuggestion(@Param('id') suggestionId: string) {
    this.logger.log(`Rejecting service suggestion: ${suggestionId}`);
    await this.serviceDiscoveryService.rejectSuggestion(suggestionId);
  }

  /**
   * Accept multiple service suggestions at once.
   */
  @Post('suggestions/accept-bulk')
  async acceptBulk(@Body() dto: AcceptBulkSuggestionsDto) {
    this.logger.log(`Accepting ${dto.suggestionIds.length} service suggestions`);
    return this.serviceDiscoveryService.acceptMultiple(dto.suggestionIds, dto.overrides);
  }
}
