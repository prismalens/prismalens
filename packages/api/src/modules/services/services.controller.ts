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
import { ServicesService } from './services.service.js';
import { CreateServiceDto, UpdateServiceDto, AddDependencyDto } from './dto/index.js';
import type { Service, ServiceWithDependencies, ServiceDependency } from './services.service.js';

@ApiTags('services')
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateServiceDto): Promise<Service> {
    // Check if service with same name exists
    const existing = await this.servicesService.findByName(dto.name);
    if (existing) {
      throw new ConflictException(`Service with name '${dto.name}' already exists`);
    }

    return this.servicesService.create(dto);
  }

  @Get()
  async findAll(
    @Query('type') type?: string,
    @Query('tier') tier?: string,
    @Query('team') team?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<Service[]> {
    return this.servicesService.findAll({
      type,
      tier,
      team,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ServiceWithDependencies> {
    const service = await this.servicesService.findById(id);

    if (!service) {
      throw new NotFoundException(`Service ${id} not found`);
    }

    return service;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateServiceDto,
  ): Promise<Service> {
    const service = await this.servicesService.update(id, dto);

    if (!service) {
      throw new NotFoundException(`Service ${id} not found`);
    }

    return service;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    const deleted = await this.servicesService.delete(id);

    if (!deleted) {
      throw new NotFoundException(`Service ${id} not found`);
    }
  }

  @Post(':id/dependencies')
  @HttpCode(HttpStatus.CREATED)
  async addDependency(
    @Param('id') id: string,
    @Body() dto: AddDependencyDto,
  ): Promise<ServiceDependency> {
    // Verify service exists
    const service = await this.servicesService.findById(id);
    if (!service) {
      throw new NotFoundException(`Service ${id} not found`);
    }

    // Verify dependency service exists
    const dependency = await this.servicesService.findById(dto.dependencyId);
    if (!dependency) {
      throw new NotFoundException(`Dependency service ${dto.dependencyId} not found`);
    }

    const result = await this.servicesService.addDependency(id, dto);

    if (!result) {
      throw new ConflictException('Dependency already exists');
    }

    return result;
  }

  @Delete(':id/dependencies/:dependencyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeDependency(
    @Param('id') id: string,
    @Param('dependencyId') dependencyId: string,
  ): Promise<void> {
    const removed = await this.servicesService.removeDependency(id, dependencyId);

    if (!removed) {
      throw new NotFoundException('Dependency not found');
    }
  }
}
