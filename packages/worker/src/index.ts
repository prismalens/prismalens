import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { createLogger } from "@prismalens/logger/standalone";
import { config } from "./config.js";
import { closeProcessor, processInvestigationJob } from "./processor.js";

// Create logger for the worker
const logger = createLogger({
	service: {
		name: "prismalens-worker",
		version: "0.1.0",
		environment: process.env.NODE_ENV ?? "development",
	},
	context: "Worker",
});

const redisConnection = new Redis(config.REDIS_URL, {
	maxRetriesPerRequest: null,
});

const worker = new Worker(config.QUEUE_NAME, processInvestigationJob, {
	connection: redisConnection,
	concurrency: config.WORKER_CONCURRENCY,
});

worker.on("completed", (job) => {
	logger.info(`Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
	logger.error(`Job ${job?.id} failed`, err);
});

// Mask Redis URL password for logging
function maskRedisUrl(url: string): string {
	try {
		const parsed = new URL(url);
		if (parsed.password) {
			parsed.password = "****";
		}
		return parsed.toString();
	} catch {
		// If not a valid URL, mask anything after :// and before @
		return url.replace(/:\/\/([^@]+)@/, "://****@");
	}
}

logger.info(`Started processing queue: ${config.QUEUE_NAME}`);
logger.info(`Redis URL: ${maskRedisUrl(config.REDIS_URL)}`);
logger.info(`API URL: ${config.API_URL}`);

// Graceful shutdown
const shutdown = async () => {
	logger.info("Shutting down...");
	await worker.close();
	await closeProcessor();
	await redisConnection.quit();
	process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
