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
import { RepositoriesService } from './repositories.service.js';
import type {
  BatchCreateRepositoriesDto,
  LinkRepositoryDto,
} from './dto/index.js';

@Controller('repositories')
export class RepositoriesController {
  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Post('batch')
  async batchCreate(@Body() dto: BatchCreateRepositoriesDto) {
    return this.repositoriesService.batchCreate(dto);
  }

  @Get()
  async list(
    @Query('connectionId') connectionId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.repositoriesService.findAll({
      connectionId,
      search,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const repo = await this.repositoriesService.findById(id);
    if (!repo) throw new NotFoundException('Repository not found');
    return repo;
  }

  @Post(':id/link')
  async link(@Param('id') id: string, @Body() dto: LinkRepositoryDto) {
    return this.repositoriesService.linkToService(id, dto);
  }

  @Delete(':id/unlink/:serviceId')
  async unlink(
    @Param('id') id: string,
    @Param('serviceId') serviceId: string,
  ) {
    await this.repositoriesService.unlinkFromService(id, serviceId);
  }
}
