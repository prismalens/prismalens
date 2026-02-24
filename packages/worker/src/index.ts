import "dotenv/config";

import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { createLogger } from "@prismalens/logger/standalone";
import { config, redisUrl } from "./config.js";
import { closeProcessor, processInvestigationJob } from "./processor.js";

const logger = createLogger({
	service: {
		name: "prismalens-worker",
		version: "0.1.0",
		environment: process.env.NODE_ENV ?? "development",
	},
	context: "Worker",
});

const redisConnection = new Redis(redisUrl, {
	maxRetriesPerRequest: null,
});

const worker = new Worker(
	config.PRISMALENS_WORKER_QUEUE_NAME,
	processInvestigationJob,
	{
		connection: redisConnection,
		concurrency: config.PRISMALENS_WORKER_CONCURRENCY,
	},
);

worker.on("completed", (job) => {
	logger.info(`Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
	logger.error(`Job ${job?.id} failed`, err);
});

logger.info(
	`Started processing queue: ${config.PRISMALENS_WORKER_QUEUE_NAME}`,
);
logger.info(
	`Redis: ${config.PRISMALENS_REDIS_HOST}:${config.PRISMALENS_REDIS_PORT}/${config.PRISMALENS_REDIS_DB}`,
);
logger.info(`API URL: ${config.PRISMALENS_WORKER_API_URL}`);

const shutdown = async () => {
	logger.info("Shutting down...");
	await worker.close();
	await closeProcessor();
	await redisConnection.quit();
	process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
