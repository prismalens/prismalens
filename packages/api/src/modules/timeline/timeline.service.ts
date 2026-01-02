import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type { TimelineEntry } from '../../../prisma/generated/client.js';
import { CreateTimelineEntryDto } from './dto/index.js';
import { TimelineEntryType, TimelineSource } from '../../shared/enums/index.js';

export type { TimelineEntry };

export type TimelineEntryWithUser = TimelineEntry & {
  user?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null;
};

@Injectable()
export class TimelineService {
  private readonly logger = new Logger(TimelineService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a timeline entry
   */
  async create(dto: CreateTimelineEntryDto): Promise<TimelineEntry> {
    const entry = await this.prisma.timelineEntry.create({
      data: {
        incidentId: dto.incidentId,
        type: dto.type,
        title: dto.title,
        description: dto.description,
        metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
        source: dto.source ?? TimelineSource.SYSTEM,
        userId: dto.userId,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      },
    });

    this.logger.debug(`Created timeline entry ${entry.id} for incident ${dto.incidentId}`);
    return entry;
  }

  /**
   * Find timeline entries by incident ID
   */
  async findByIncidentId(
    incidentId: string,
    options?: {
      type?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<TimelineEntryWithUser[]> {
    return this.prisma.timelineEntry.findMany({
      where: {
        incidentId,
        ...(options?.type && { type: options.type }),
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { occurredAt: 'desc' },
      take: options?.limit,
      skip: options?.offset,
    });
  }

  /**
   * Find a single timeline entry by ID
   */
  async findById(id: string): Promise<TimelineEntryWithUser | null> {
    return this.prisma.timelineEntry.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  /**
   * Delete a timeline entry
   */
  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.timelineEntry.delete({
        where: { id },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Count timeline entries for an incident
   */
  async countByIncidentId(incidentId: string): Promise<number> {
    return this.prisma.timelineEntry.count({
      where: { incidentId },
    });
  }

  /**
   * Add a comment to an incident timeline
   */
  async addComment(
    incidentId: string,
    comment: string,
    userId?: string,
  ): Promise<TimelineEntry> {
    return this.create({
      incidentId,
      type: TimelineEntryType.COMMENT,
      title: 'Comment added',
      description: comment,
      source: userId ? TimelineSource.USER : TimelineSource.SYSTEM,
      userId,
    });
  }
}
