import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CorrelationService } from './correlation.service.js';
import { CreateCorrelationRuleDto, UpdateCorrelationRuleDto } from './dto/index.js';
import type { CorrelationRule } from './correlation.service.js';

@ApiTags('correlation')
@Controller('correlation')
export class CorrelationController {
  constructor(private readonly correlationService: CorrelationService) {}

  @Post('rules')
  @HttpCode(HttpStatus.CREATED)
  async createRule(@Body() dto: CreateCorrelationRuleDto): Promise<CorrelationRule> {
    try {
      return await this.correlationService.createRule(dto);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(`Rule with name '${dto.name}' already exists`);
      }
      throw error;
    }
  }

  @Get('rules')
  async findAllRules(
    @Query('enabled') enabled?: string,
  ): Promise<CorrelationRule[]> {
    return this.correlationService.findAllRules({
      enabled: enabled !== undefined ? enabled === 'true' : undefined,
    });
  }

  @Get('rules/:id')
  async findRuleById(@Param('id') id: string): Promise<CorrelationRule> {
    const rule = await this.correlationService.findRuleById(id);

    if (!rule) {
      throw new NotFoundException(`Correlation rule ${id} not found`);
    }

    return rule;
  }

  @Patch('rules/:id')
  async updateRule(
    @Param('id') id: string,
    @Body() dto: UpdateCorrelationRuleDto,
  ): Promise<CorrelationRule> {
    const rule = await this.correlationService.updateRule(id, dto);

    if (!rule) {
      throw new NotFoundException(`Correlation rule ${id} not found`);
    }

    return rule;
  }

  @Delete('rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRule(@Param('id') id: string): Promise<void> {
    const deleted = await this.correlationService.deleteRule(id);

    if (!deleted) {
      throw new NotFoundException(`Correlation rule ${id} not found`);
    }
  }
}
