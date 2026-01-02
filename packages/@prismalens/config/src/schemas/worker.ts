import { z } from 'zod';

/**
 * Worker configuration schema.
 */
export const workerSchema = z.object({
  PRISMALENS_WORKER_MODE: z
    .enum(['regular', 'queue'])
    .default('regular')
    .describe('Worker operation mode: regular (no Redis, HTTP dispatch) or queue (Redis-backed BullMQ)'),
  PRISMALENS_WORKER_URL: z
    .string()
    .default('http://localhost:8082')
    .describe('Worker job submission URL (for regular mode)'),
  PRISMALENS_WORKER_CONCURRENCY: z.coerce
    .number()
    .default(5)
    .describe('Max concurrent investigations'),
  PRISMALENS_WORKER_HEALTH_PORT: z.coerce
    .number()
    .default(8081)
    .describe('Health endpoint port'),
  PRISMALENS_WORKER_JOB_PORT: z.coerce
    .number()
    .default(8082)
    .describe('Job submission port (regular mode)'),
  PRISMALENS_GRACEFUL_SHUTDOWN_TIMEOUT: z.coerce
    .number()
    .default(30)
    .describe('Graceful shutdown timeout in seconds'),
});

export type WorkerConfig = z.infer<typeof workerSchema>;
