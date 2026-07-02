import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { CanonicalEventSchema } from '@prismalens/contracts';
import { buildRedisUrl, getConfig } from '@prismalens/config';
import type { ConnectionOptions } from 'bullmq';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { StreamRelayService } from '../../modules/investigations/stream-relay.service.js';

/**
 * Job data for investigation queue (incident-centric).
 *
 * SECURITY: This payload is serialized to Redis.
 * Never include decrypted credentials. Use connectionIds instead,
 * and the worker fetches credentials on-demand via internal API.
 */
export interface InvestigationJobData {
  incidentId: string;
  investigationId: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  context?: Record<string, unknown>;
  /** Connection IDs — worker fetches credentials on-demand */
  connectionIds?: string[];
}

/**
 * Result returned by investigation worker.
 */
export interface InvestigationJobResult {
  success: boolean;
  investigationId: string;
  summary?: string;
  rootCause?: string;
  recommendations?: unknown[];
  error?: string;
}

// =============================================================================
// QUEUE CONFIGURATION CONSTANTS
// =============================================================================

/** Maximum retry attempts for failed jobs */
const JOB_MAX_ATTEMPTS = 3;

/** Initial backoff delay in ms (exponential) */
const JOB_BACKOFF_DELAY_MS = 1000;

/** Keep last N completed jobs */
const COMPLETED_JOB_RETENTION_COUNT = 100;

/** Remove completed jobs older than 24 hours */
const COMPLETED_JOB_RETENTION_AGE_S = 24 * 60 * 60;

/** Keep last N failed jobs */
const FAILED_JOB_RETENTION_COUNT = 50;

/** Remove failed jobs older than 7 days */
const FAILED_JOB_RETENTION_AGE_S = 7 * 24 * 60 * 60;

/**
 * Queue service — BullMQ-backed investigation job management.
 * Enqueues jobs to Redis and relays stream events to SSE clients.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);

  // Queue resources
  private investigationQueue: Queue<
    InvestigationJobData,
    InvestigationJobResult
  > | null = null;
  private queueEvents: QueueEvents | null = null;
  private connection: ConnectionOptions | null = null;

  // Redis subscriber for stream relay
  private redisSubscriber: Redis | null = null;

  constructor(private streamRelay: StreamRelayService) {}

  async onModuleInit() {
    this.logger.log('Initializing BullMQ queue');

    try {
      const redisUrl = buildRedisUrl(getConfig());
      this.connection = { url: redisUrl };

      this.investigationQueue = new Queue<
        InvestigationJobData,
        InvestigationJobResult
      >('investigation', {
        connection: this.connection,
        defaultJobOptions: {
          attempts: JOB_MAX_ATTEMPTS,
          backoff: {
            type: 'exponential',
            delay: JOB_BACKOFF_DELAY_MS,
          },
          removeOnComplete: {
            count: COMPLETED_JOB_RETENTION_COUNT,
            age: COMPLETED_JOB_RETENTION_AGE_S,
          },
          removeOnFail: {
            count: FAILED_JOB_RETENTION_COUNT,
            age: FAILED_JOB_RETENTION_AGE_S,
          },
        },
      });

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

      // Initialize Redis subscriber for stream relay
      this.redisSubscriber = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
      });
      this.redisSubscriber.on('message', (channel: string, message: string) => {
        this.handleRedisStreamMessage(channel, message);
      });

      this.logger.log('Queue service initialized with Redis');
    } catch (error) {
      this.logger.error(
        `Failed to initialize queue: ${(error as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.redisSubscriber) {
      await this.redisSubscriber.quit();
    }
    if (this.queueEvents) {
      await this.queueEvents.close();
    }
    if (this.investigationQueue) {
      await this.investigationQueue.close();
    }
  }

  /**
   * Add an investigation job to the BullMQ queue.
   *
   * SECURITY: Only connectionIds are stored in Redis.
   * The worker fetches decrypted credentials on-demand via internal API.
   */
  async addInvestigationJob(
    data: InvestigationJobData,
  ): Promise<string | null> {
    if (!this.investigationQueue) {
      this.logger.warn('Queue not available - job not added');
      return null;
    }

    const priority = this.getPriorityValue(data.priority);

    const job = await this.investigationQueue.add('investigate', data, {
      priority,
      jobId: `investigation-${data.investigationId}`,
    });

    // Subscribe to Redis pub/sub for stream relay to SSE clients
    this.subscribeToRedisStream(data.investigationId);

    this.logger.log(
      `Added investigation job ${job.id} for incident ${data.incidentId}`,
    );

    return job.id ?? null;
  }

  /**
   * Get status of a job by ID.
   */
  async getJobStatus(jobId: string): Promise<{
    status: string;
    progress: number;
    result?: InvestigationJobResult;
  } | null> {
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
   * Handle incoming Redis pub/sub messages for stream relay.
   */
  private handleRedisStreamMessage(channel: string, message: string): void {
    // Channel format: investigation:events:{investigationId}
    const prefix = 'investigation:events:';
    if (!channel.startsWith(prefix)) return;

    const investigationId = channel.slice(prefix.length);

    try {
      const parsed = JSON.parse(message) as unknown;

      // The worker emits a terminal ["__done__", {}] sentinel to close the
      // stream; every other message is a CanonicalEvent.
      if (Array.isArray(parsed) && parsed[0] === '__done__') {
        this.streamRelay.complete(investigationId);
        this.redisSubscriber?.unsubscribe(channel).catch((err) => {
          this.logger.warn(
            `Failed to unsubscribe from ${channel}: ${(err as Error).message}`,
          );
        });
      } else {
        const parsedEvent = CanonicalEventSchema.safeParse(parsed);
        if (!parsedEvent.success) {
          this.logger.warn(
            `Dropped invalid CanonicalEvent on ${channel} for investigation ${investigationId}: ${parsedEvent.error.message}`,
          );
          return;
        }
        this.streamRelay.emit(investigationId, parsedEvent.data);
      }
    } catch {
      this.logger.warn(`Failed to parse Redis stream message on ${channel}`);
    }
  }

  /**
   * Subscribe to Redis pub/sub channel for an investigation.
   * Called when a job is enqueued so the API can relay events to SSE clients.
   */
  private subscribeToRedisStream(investigationId: string): void {
    if (!this.redisSubscriber) return;

    const channel = `investigation:events:${investigationId}`;
    this.redisSubscriber.subscribe(channel).catch((err) => {
      this.logger.error(
        `Failed to subscribe to ${channel}: ${(err as Error).message}`,
      );
    });
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
