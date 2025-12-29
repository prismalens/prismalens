import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Alert } from '../../prisma/generated/client.js';
import { CreateAlertDto, UpdateAlertDto } from './dto/index.js';

export { CreateAlertDto, UpdateAlertDto };
export type { Alert };

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAlertDto): Promise<Alert> {
    const alert = await this.prisma.alert.create({
      data: {
        source: dto.source,
        externalId: dto.externalId,
        severity: dto.severity ?? 'medium',
        title: dto.title,
        description: dto.description ?? '',
        sourceUrl: dto.sourceUrl,
        rawPayload: dto.rawPayload ? JSON.stringify(dto.rawPayload) : null,
        status: 'new',
      },
    });

    this.logger.log(`Created alert ${alert.id}: ${alert.title}`);
    return alert;
  }

  async findById(id: string): Promise<Alert | null> {
    return this.prisma.alert.findUnique({
      where: { id },
      include: {
        analysisRuns: {
          include: {
            recommendations: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async findByExternalId(externalId: string): Promise<Alert | null> {
    return this.prisma.alert.findUnique({
      where: { externalId },
    });
  }

  async findAll(options?: {
    status?: string;
    severity?: string;
    limit?: number;
    offset?: number;
  }): Promise<Alert[]> {
    return this.prisma.alert.findMany({
      where: {
        ...(options?.status && { status: options.status }),
        ...(options?.severity && { severity: options.severity }),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit,
      skip: options?.offset,
    });
  }

  async update(id: string, dto: UpdateAlertDto): Promise<Alert | null> {
    try {
      const alert = await this.prisma.alert.update({
        where: { id },
        data: {
          ...dto,
          updatedAt: new Date(),
        },
      });

      this.logger.log(`Updated alert ${id}`);
      return alert;
    } catch {
      return null;
    }
  }

  async updateStatus(id: string, status: string): Promise<Alert | null> {
    return this.update(id, { status });
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.alert.delete({
        where: { id },
      });
      this.logger.log(`Deleted alert ${id}`);
      return true;
    } catch {
      return false;
    }
  }

  async count(options?: { status?: string; severity?: string }): Promise<number> {
    return this.prisma.alert.count({
      where: {
        ...(options?.status && { status: options.status }),
        ...(options?.severity && { severity: options.severity }),
      },
    });
  }
}
