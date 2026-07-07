// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";

/**
 * Redis configuration schema for queue mode.
 */
export const redisSchema = z.object({
	PRISMALENS_REDIS_HOST: z
		.string()
		.default("localhost")
		.describe("Redis host for queue mode"),
	PRISMALENS_REDIS_PORT: z.coerce
		.number()
		.default(6379)
		.describe("Redis port for queue mode"),
	PRISMALENS_REDIS_USERNAME: z
		.string()
		.default("")
		.describe("Redis username for queue mode (if applicable)"),
	PRISMALENS_REDIS_PASSWORD: z
		.string()
		.default("")
		.describe("Redis password for queue mode (if applicable)"),
	PRISMALENS_REDIS_DB: z.coerce
		.number()
		.default(0)
		.describe("Redis database index for queue mode"),
	PRISMALENS_REDIS_TLS: z.coerce
		.boolean()
		.default(false)
		.describe("Use TLS for Redis connection"),
	PRISMALENS_REDIS_CA: z
		.string()
		.default("")
		.describe("Redis CA certificate (if applicable)"),
	PRISMALENS_REDIS_CLUSTER_NODES: z
		.string()
		.default("")
		.describe(
			'Redis cluster nodes (comma-separated host:port) for queue mode (if applicable), e.g. "host1:6379,host2:6379"',
		),
});

/**
 * Queue configuration schema (Redis settings for queue mode).
 * Worker settings are in worker.ts.
 */
export const queueSchema = redisSchema;

export type QueueConfig = z.infer<typeof queueSchema>;
