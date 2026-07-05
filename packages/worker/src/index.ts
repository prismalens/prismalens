// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@prismalens/logger/standalone";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { config, redisUrl } from "./config.js";

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

// Sandboxed processor: each job runs in a forked child process with isolated
// process.env, preventing LLM credential races between concurrent jobs.
// Do NOT use useWorkerThreads — worker threads share process.env.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const processorTs = path.join(__dirname, "processor.ts");
const processorFile = fs.existsSync(processorTs)
	? processorTs
	: path.join(__dirname, "processor.js");

const worker = new Worker(config.PRISMALENS_WORKER_QUEUE_NAME, processorFile, {
	connection: redisConnection,
	concurrency: config.PRISMALENS_WORKER_CONCURRENCY,
});

worker.on("completed", (job) => {
	logger.info(`Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
	logger.error(`Job ${job?.id} failed`, err);
});

logger.info(`Started processing queue: ${config.PRISMALENS_WORKER_QUEUE_NAME}`);
logger.info(
	`Redis: ${config.PRISMALENS_REDIS_HOST}:${config.PRISMALENS_REDIS_PORT}/${config.PRISMALENS_REDIS_DB}`,
);
logger.info(`API URL: ${config.PRISMALENS_WORKER_API_URL}`);

const shutdown = async () => {
	logger.info("Shutting down...");
	await worker.close();
	await redisConnection.quit();
	process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
