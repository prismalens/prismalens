import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EventsService } from './events.service.js';
import type { EventWithAlert } from './events.service.js';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  async findAll(
    @Query('source') source?: string,
    @Query('eventType') eventType?: string,
    @Query('processed') processed?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<EventWithAlert[]> {
    return this.eventsService.findAll({
      source,
      eventType,
      processed: processed !== undefined ? processed === 'true' : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<EventWithAlert> {
    const event = await this.eventsService.findById(id);

    if (!event) {
      throw new NotFoundException(`Event ${id} not found`);
    }

    return event;
  }

  @Get('alert/:alertId')
  async findByAlert(@Param('alertId') alertId: string) {
    return this.eventsService.findByAlertId(alertId);
  }
}
