import { BullModule } from '@nestjs/bullmq';
import {
  type DynamicModule,
  Global,
  Logger,
  Module,
  forwardRef,
} from '@nestjs/common';
import { buildRedisOptions, getConfig } from '@prismalens/config';
import * as IORedis from 'ioredis';
import { InvestigationsModule } from '../../modules/investigations/investigations.module.js';
import { QueueService } from './queue.service.js';

const config = getConfig();
const logger = new Logger('QueueModule');

/**
 * Build Redis connection for BullMQ.
 */
function buildRedisConnection(): IORedis.Redis | IORedis.Cluster {
  if (config.PRISMALENS_REDIS_CLUSTER_NODES) {
    const nodes = config.PRISMALENS_REDIS_CLUSTER_NODES.split(',').map(
      (node) => {
        const [host, port] = node.split(':');
        return { host, port: parseInt(port, 10) };
      },
    );
    const opts = buildRedisOptions(config);
    return new IORedis.Cluster(nodes, {
      redisOptions: { ...opts, maxRetriesPerRequest: null },
    });
  }
  return new IORedis.Redis({
    ...buildRedisOptions(config),
    maxRetriesPerRequest: null,
  });
}

/**
 * Queue module — always initializes BullMQ with Redis.
 * Redis is a hard dependency for investigation job processing.
 */
@Global()
@Module({})
export class QueueModule {
  static forRoot(): DynamicModule {
    logger.log('Initializing BullMQ with Redis connection');
    const redisConnection = buildRedisConnection();

    return {
      module: QueueModule,
      imports: [
        forwardRef(() => InvestigationsModule),
        BullModule.forRoot({
          connection: redisConnection,
        }),
      ],
      providers: [QueueService],
      exports: [QueueService],
    };
  }
}
