import { Worker } from 'bullmq';
import { config } from './config.js';
import { processInvestigationJob, closeProcessor } from './processor.js';
import { Redis } from 'ioredis';

const redisConnection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const worker = new Worker(config.QUEUE_NAME, processInvestigationJob, {
  connection: redisConnection,
  concurrency: config.WORKER_CONCURRENCY,
});

worker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed!`);
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed: ${err.message}`);
});

console.log(`[Worker] Started processing queue: ${config.QUEUE_NAME}`);
console.log(`[Worker] Redis URL: ${config.REDIS_URL}`);
console.log(`[Worker] API URL: ${config.API_URL}`);

// Graceful shutdown
const shutdown = async () => {
  console.log('[Worker] Shutting down...');
  await worker.close();
  await closeProcessor();
  await redisConnection.quit();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
