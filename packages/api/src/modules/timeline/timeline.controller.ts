import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TimelineService } from './timeline.service.js';
import { CreateTimelineEntryDto } from './dto/index.js';
import type { TimelineEntryWithUser } from './timeline.service.js';

@ApiTags('timeline')
@Controller('timeline')
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) {}

  @Get('incident/:incidentId')
  async findByIncident(
    @Param('incidentId') incidentId: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<TimelineEntryWithUser[]> {
    return this.timelineService.findByIncidentId(incidentId, {
      type,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<TimelineEntryWithUser> {
    const entry = await this.timelineService.findById(id);

    if (!entry) {
      throw new NotFoundException(`Timeline entry ${id} not found`);
    }

    return entry;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateTimelineEntryDto) {
    return this.timelineService.create(dto);
  }

  @Post('incident/:incidentId/comment')
  @HttpCode(HttpStatus.CREATED)
  async addComment(
    @Param('incidentId') incidentId: string,
    @Body() body: { comment: string; userId?: string },
  ) {
    return this.timelineService.addComment(incidentId, body.comment, body.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    const deleted = await this.timelineService.delete(id);

    if (!deleted) {
      throw new NotFoundException(`Timeline entry ${id} not found`);
    }
  }
}
