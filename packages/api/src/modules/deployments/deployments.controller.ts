import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { DeploymentsService } from './deployments.service.js';
import type {
  BatchCreateDeploymentsDto,
  LinkDeploymentDto,
} from './dto/index.js';

@Controller('deployments')
export class DeploymentsController {
  constructor(private readonly deploymentsService: DeploymentsService) {}

  @Post('batch')
  async batchCreate(@Body() dto: BatchCreateDeploymentsDto) {
    return this.deploymentsService.batchCreate(dto);
  }

  @Get()
  async list(
    @Query('connectionId') connectionId?: string,
    @Query('serviceId') serviceId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.deploymentsService.findAll({
      connectionId,
      serviceId,
      search,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const deployment = await this.deploymentsService.findById(id);
    if (!deployment) throw new NotFoundException('Deployment not found');
    return deployment;
  }

  @Post(':id/link')
  async link(@Param('id') id: string, @Body() dto: LinkDeploymentDto) {
    return this.deploymentsService.linkToService(id, dto);
  }

  @Delete(':id/unlink')
  async unlink(@Param('id') id: string) {
    await this.deploymentsService.unlinkFromService(id);
  }
}
