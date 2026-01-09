import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type { Event } from '@prismalens/database';
import { CreateEventDto } from './dto/index.js';

export type { Event };

export type EventWithAlert = Event & {
  alert?: {
    id: string;
    title: string;
    status: string;
    severity: string;
  } | null;
};

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a raw event (immutable record of incoming signal)
   */
  async create(dto: CreateEventDto): Promise<Event> {
    const event = await this.prisma.event.create({
      data: {
        source: dto.source,
        sourceEventId: dto.sourceEventId,
        eventType: dto.eventType,
        payload: typeof dto.payload === 'string' ? dto.payload : JSON.stringify(dto.payload),
        eventTime: dto.eventTime ? new Date(dto.eventTime) : null,
        processed: false,
      },
    });

    this.logger.log(`Created event ${event.id} from ${dto.source}`);
    return event;
  }

  /**
   * Find event by ID
   */
  async findById(id: string): Promise<EventWithAlert | null> {
    return this.prisma.event.findUnique({
      where: { id },
      include: {
        alert: {
          select: {
            id: true,
            title: true,
            status: true,
            severity: true,
          },
        },
      },
    });
  }

  /**
   * Find events by alert ID
   */
  async findByAlertId(alertId: string): Promise<Event[]> {
    return this.prisma.event.findMany({
      where: { alertId },
      orderBy: { receivedAt: 'desc' },
    });
  }

  /**
   * Find all events with optional filters
   */
  async findAll(options?: {
    source?: string;
    eventType?: string;
    processed?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<EventWithAlert[]> {
    return this.prisma.event.findMany({
      where: {
        ...(options?.source && { source: options.source }),
        ...(options?.eventType && { eventType: options.eventType }),
        ...(options?.processed !== undefined && { processed: options.processed }),
      },
      include: {
        alert: {
          select: {
            id: true,
            title: true,
            status: true,
            severity: true,
          },
        },
      },
      orderBy: { receivedAt: 'desc' },
      take: options?.limit,
      skip: options?.offset,
    });
  }

  /**
   * Mark event as processed and link to alert
   */
  async markProcessed(id: string, alertId: string): Promise<Event | null> {
    try {
      return await this.prisma.event.update({
        where: { id },
        data: {
          processed: true,
          alertId,
        },
      });
    } catch {
      return null;
    }
  }

  /**
   * Find unprocessed events
   */
  async findUnprocessed(limit: number = 100): Promise<Event[]> {
    return this.prisma.event.findMany({
      where: { processed: false },
      orderBy: { receivedAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Count events
   */
  async count(options?: {
    source?: string;
    eventType?: string;
    processed?: boolean;
  }): Promise<number> {
    return this.prisma.event.count({
      where: {
        ...(options?.source && { source: options.source }),
        ...(options?.eventType && { eventType: options.eventType }),
        ...(options?.processed !== undefined && { processed: options.processed }),
      },
    });
  }
}
