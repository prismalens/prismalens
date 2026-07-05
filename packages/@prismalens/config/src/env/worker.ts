// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";

/**
 * Worker-specific configuration schema.
 * Used by the worker process only (not merged into API's baseConfigSchema).
 */
export const workerSchema = z.object({
	PRISMALENS_WORKER_API_URL: z
		.string()
		.url("PRISMALENS_WORKER_API_URL must be a valid URL")
		.default("http://localhost:5367/api")
		.describe("API URL the worker uses for oRPC calls"),
	PRISMALENS_WORKER_CONCURRENCY: z.coerce
		.number()
		.int()
		.min(1, "Concurrency must be at least 1")
		.max(100, "Concurrency must not exceed 100")
		.default(5)
		.describe("Max concurrent BullMQ jobs"),
	PRISMALENS_WORKER_QUEUE_NAME: z
		.string()
		.default("investigation")
		.describe("BullMQ queue name"),
});

export type WorkerConfig = z.infer<typeof workerSchema>;
