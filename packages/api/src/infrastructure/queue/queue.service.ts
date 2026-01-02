import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { Queue, QueueEvents } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { getConfig } from '@prismalens/config';
import { firstValueFrom } from 'rxjs';

const config = getConfig();

/**
 * Integration context for worker (matches Python IntegrationContext)
 */
export interface IntegrationContext {
  type: string;
  connectionId: string;
  credentials: Record<string, unknown>;
  config: Record<string, unknown>;
  serviceOverrides?: Record<string, unknown>;
}

/**
 * Job data for investigation queue (incident-centric)
 */
export interface InvestigationJobData {
  incidentId: string;
  investigationId: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  context?: Record<string, unknown>;
  integrations?: IntegrationContext[];
  incidentData?: Record<string, unknown>;
  alerts?: unknown[];
}

/**
 * Result returned by investigation worker
 */
export interface InvestigationJobResult {
  success: boolean;
  investigationId: string;
  summary?: string;
  rootCause?: string;
  recommendations?: unknown[];
  error?: string;
}

/**
 * Queue service with dual-mode support:
 * - regular mode: Direct HTTP dispatch to worker (no Redis)
 * - queue mode: BullMQ queue with Redis
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly workerMode: 'regular' | 'queue';
  private readonly workerUrl: string;

  // Queue mode resources (only initialized in queue mode)
  private investigationQueue: Queue<InvestigationJobData, InvestigationJobResult> | null = null;
  private queueEvents: QueueEvents | null = null;
  private connection: ConnectionOptions | null = null;

  constructor(private readonly httpService: HttpService) {
    this.workerMode = config.PRISMALENS_WORKER_MODE as 'regular' | 'queue';
    this.workerUrl = config.PRISMALENS_WORKER_URL;
  }

  async onModuleInit() {
    if (this.workerMode === 'regular') {
      this.logger.log(`Regular mode: Jobs will be dispatched via HTTP to ${this.workerUrl}`);
      return;
    }

    // Queue mode: Initialize BullMQ
    this.logger.log('Queue mode: Initializing BullMQ queue');

    try {
      // Build Redis URL from config
      const redisUrl = this.buildRedisUrl();
      this.connection = { url: redisUrl };

      this.investigationQueue = new Queue<InvestigationJobData, InvestigationJobResult>(
        'investigation',
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

      this.queueEvents = new QueueEvents('investigation', {
        connection: this.connection,
      });

      // Log queue events
      this.queueEvents.on('completed', ({ jobId }) => {
        this.logger.log(`Investigation job ${jobId} completed`);
      });

      this.queueEvents.on('failed', ({ jobId, failedReason }) => {
        this.logger.error(`Investigation job ${jobId} failed: ${failedReason}`);
      });

      this.logger.log('Queue service initialized with Redis');
    } catch (error) {
      this.logger.error(`Failed to initialize queue: ${(error as Error).message}`);
    }
  }

  private buildRedisUrl(): string {
    const { PRISMALENS_REDIS_HOST, PRISMALENS_REDIS_PORT, PRISMALENS_REDIS_PASSWORD, PRISMALENS_REDIS_DB } = config;
    const auth = PRISMALENS_REDIS_PASSWORD ? `:${PRISMALENS_REDIS_PASSWORD}@` : '';
    return `redis://${auth}${PRISMALENS_REDIS_HOST}:${PRISMALENS_REDIS_PORT}/${PRISMALENS_REDIS_DB}`;
  }

  async onModuleDestroy() {
    if (this.queueEvents) {
      await this.queueEvents.close();
    }
    if (this.investigationQueue) {
      await this.investigationQueue.close();
    }
  }

  /**
   * Check if job dispatching is available.
   * - Regular mode: Always true (HTTP dispatch)
   * - Queue mode: True if Redis queue is initialized
   */
  isEnabled(): boolean {
    if (this.workerMode === 'regular') {
      return true;
    }
    return this.investigationQueue !== null;
  }

  /**
   * Get the current worker mode.
   */
  getWorkerMode(): 'regular' | 'queue' {
    return this.workerMode;
  }

  /**
   * Add an investigation job.
   * - Regular mode: Dispatches directly to worker via HTTP
   * - Queue mode: Adds to BullMQ queue
   */
  async addInvestigationJob(data: InvestigationJobData): Promise<string | null> {
    if (this.workerMode === 'regular') {
      return this.dispatchViaHttp(data);
    }

    return this.enqueueToRedis(data);
  }

  /**
   * Dispatch job directly to worker via HTTP (regular mode).
   */
  private async dispatchViaHttp(data: InvestigationJobData): Promise<string | null> {
    const jobId = `direct-${data.investigationId}`;

    try {
      this.logger.log(`Dispatching job ${jobId} to worker at ${this.workerUrl}/jobs`);

      await firstValueFrom(
        this.httpService.post(`${this.workerUrl}/jobs`, data, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000, // 5 second timeout for job submission
        }),
      );

      this.logger.log(`Job ${jobId} dispatched successfully`);
      return jobId;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to dispatch job to worker: ${err.message}`);

      // Check if worker is not running
      if (err.message.includes('ECONNREFUSED')) {
        this.logger.warn(`Worker not available at ${this.workerUrl}. Is the worker running?`);
      }

      return null;
    }
  }

  /**
   * Enqueue job to Redis via BullMQ (queue mode).
   */
  private async enqueueToRedis(data: InvestigationJobData): Promise<string | null> {
    if (!this.investigationQueue) {
      this.logger.warn('Queue not available - job not added');
      return null;
    }

    const priority = this.getPriorityValue(data.priority);

    const job = await this.investigationQueue.add('investigate', data, {
      priority,
      jobId: `investigation-${data.investigationId}`,
    });

    this.logger.log(`Added investigation job ${job.id} for incident ${data.incidentId}`);

    return job.id ?? null;
  }

  /**
   * Get status of a job by ID.
   * Only available in queue mode.
   */
  async getJobStatus(jobId: string): Promise<{
    status: string;
    progress: number;
    result?: InvestigationJobResult;
  } | null> {
    if (this.workerMode === 'regular') {
      // In regular mode, job status is not tracked by the API
      // The worker handles execution directly
      this.logger.debug('Job status not available in regular mode');
      return null;
    }

    if (!this.investigationQueue) {
      return null;
    }

    const job = await this.investigationQueue.getJob(jobId);

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

  /**
   * Get queue statistics.
   * Only available in queue mode.
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  } | null> {
    if (this.workerMode === 'regular') {
      // In regular mode, queue stats are not available
      return null;
    }

    if (!this.investigationQueue) {
      return null;
    }

    const [waiting, active, completed, failed] = await Promise.all([
      this.investigationQueue.getWaitingCount(),
      this.investigationQueue.getActiveCount(),
      this.investigationQueue.getCompletedCount(),
      this.investigationQueue.getFailedCount(),
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
