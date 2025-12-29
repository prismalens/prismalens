import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';

export interface AnalysisJobData {
  alertId: string;
  analysisRunId: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  context?: Record<string, unknown>;
}

export interface AnalysisJobResult {
  success: boolean;
  analysisRunId: string;
  findings?: unknown;
  recommendations?: unknown[];
  error?: string;
}

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private analysisQueue: Queue<AnalysisJobData, AnalysisJobResult> | null = null;
  private queueEvents: QueueEvents | null = null;
  private connection: ConnectionOptions | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL');

    if (!redisUrl) {
      this.logger.warn('REDIS_URL not configured - queue functionality disabled');
      this.logger.warn('Set REDIS_URL to enable background job processing');
      return;
    }

    try {
      this.connection = { url: redisUrl };

      this.analysisQueue = new Queue<AnalysisJobData, AnalysisJobResult>(
        'analysis',
        {
          connection: this.connection,
          defaultJobOptions: {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 1000,
            },
            removeOnComplete: {
              count: 100,
              age: 24 * 60 * 60, // 24 hours
            },
            removeOnFail: {
              count: 50,
              age: 7 * 24 * 60 * 60, // 7 days
            },
          },
        },
      );

      this.queueEvents = new QueueEvents('analysis', {
        connection: this.connection,
      });

      // Log queue events
      this.queueEvents.on('completed', ({ jobId }) => {
        this.logger.log(`Job ${jobId} completed`);
      });

      this.queueEvents.on('failed', ({ jobId, failedReason }) => {
        this.logger.error(`Job ${jobId} failed: ${failedReason}`);
      });

      this.logger.log('Queue service initialized with Redis');
    } catch (error) {
      this.logger.error(`Failed to initialize queue: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy() {
    if (this.queueEvents) {
      await this.queueEvents.close();
    }
    if (this.analysisQueue) {
      await this.analysisQueue.close();
    }
  }

  isEnabled(): boolean {
    return this.analysisQueue !== null;
  }

  async addAnalysisJob(data: AnalysisJobData): Promise<string | null> {
    if (!this.analysisQueue) {
      this.logger.warn('Queue not available - job not added');
      return null;
    }

    const priority = this.getPriorityValue(data.priority);

    const job = await this.analysisQueue.add('analyze', data, {
      priority,
      jobId: `analysis-${data.analysisRunId}`,
    });

    this.logger.log(`Added analysis job ${job.id} for alert ${data.alertId}`);

    return job.id ?? null;
  }

  async getJobStatus(jobId: string): Promise<{
    status: string;
    progress: number;
    result?: AnalysisJobResult;
  } | null> {
    if (!this.analysisQueue) {
      return null;
    }

    const job = await this.analysisQueue.getJob(jobId);

    if (!job) {
      return null;
    }

    const state = await job.getState();
    const progress = job.progress as number;

    return {
      status: state,
      progress: typeof progress === 'number' ? progress : 0,
      result: job.returnvalue ?? undefined,
    };
  }

  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  } | null> {
    if (!this.analysisQueue) {
      return null;
    }

    const [waiting, active, completed, failed] = await Promise.all([
      this.analysisQueue.getWaitingCount(),
      this.analysisQueue.getActiveCount(),
      this.analysisQueue.getCompletedCount(),
      this.analysisQueue.getFailedCount(),
    ]);

    return { waiting, active, completed, failed };
  }

  private getPriorityValue(priority?: string): number {
    switch (priority) {
      case 'critical':
        return 1;
      case 'high':
        return 2;
      case 'normal':
        return 3;
      case 'low':
        return 4;
      default:
        return 3;
    }
  }
}
