import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { AlertMappingService } from './alert-mapping.service.js';
import { CreateMappingRuleDto, UpdateMappingRuleDto, TestMappingDto } from './dto/index.js';

@Controller('alert-mapping')
export class AlertMappingController {
  private readonly logger = new Logger(AlertMappingController.name);

  constructor(private readonly alertMappingService: AlertMappingService) {}

  /**
   * Create a new alert mapping rule.
   */
  @Post('rules')
  async createRule(@Body() dto: CreateMappingRuleDto) {
    this.logger.log(`Creating alert mapping rule: ${dto.name}`);
    return this.alertMappingService.create(dto);
  }

  /**
   * List all alert mapping rules.
   */
  @Get('rules')
  async listRules() {
    return this.alertMappingService.findAll();
  }

  /**
   * Get a specific alert mapping rule.
   */
  @Get('rules/:id')
  async getRule(@Param('id') id: string) {
    return this.alertMappingService.findById(id);
  }

  /**
   * Update an alert mapping rule.
   */
  @Patch('rules/:id')
  async updateRule(@Param('id') id: string, @Body() dto: UpdateMappingRuleDto) {
    this.logger.log(`Updating alert mapping rule: ${id}`);
    return this.alertMappingService.update(id, dto);
  }

  /**
   * Delete an alert mapping rule.
   */
  @Delete('rules/:id')
  @HttpCode(204)
  async deleteRule(@Param('id') id: string) {
    this.logger.log(`Deleting alert mapping rule: ${id}`);
    await this.alertMappingService.delete(id);
  }

  /**
   * Test which service an alert would map to.
   */
  @Post('test')
  async testMapping(@Body() dto: TestMappingDto) {
    this.logger.log(`Testing mapping for alert: "${dto.title}"`);
    const service = await this.alertMappingService.resolveServiceForAlert({
      source: dto.source,
      labels: dto.labels,
      tags: dto.tags,
      title: dto.title,
      description: dto.description,
    });

    return {
      matched: service !== null,
      service: service || null,
    };
  }
}
