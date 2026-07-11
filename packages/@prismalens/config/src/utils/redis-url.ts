// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Utility functions for building Redis connection URLs and options from config.
 * Follows the same pattern as database-url.ts.
 */

import { readFileSync } from "node:fs";
import type { QueueConfig } from "../env/queue.js";

/**
 * Redis connection options compatible with ioredis RedisOptions.
 * Defined here to avoid adding ioredis as a dependency to the config package.
 */
export interface RedisConnectionOptions {
	host: string;
	port: number;
	username?: string;
	password?: string;
	db: number;
	tls?: { ca?: Buffer };
}

/**
 * Build a Redis connection URL from structured config.
 * Used by both API and worker packages.
 */
export function buildRedisUrl(config: QueueConfig): string {
	const {
		PRISMALENS_REDIS_HOST,
		PRISMALENS_REDIS_PORT,
		PRISMALENS_REDIS_PASSWORD,
		PRISMALENS_REDIS_USERNAME,
		PRISMALENS_REDIS_DB,
		PRISMALENS_REDIS_TLS,
	} = config;

	const encodedUser = PRISMALENS_REDIS_USERNAME
		? encodeURIComponent(PRISMALENS_REDIS_USERNAME)
		: "";
	const encodedPass = PRISMALENS_REDIS_PASSWORD
		? encodeURIComponent(PRISMALENS_REDIS_PASSWORD)
		: "";

	const auth = encodedPass
		? encodedUser
			? `${encodedUser}:${encodedPass}@`
			: `:${encodedPass}@`
		: "";
	const protocol = PRISMALENS_REDIS_TLS ? "rediss" : "redis";
	return `${protocol}://${auth}${PRISMALENS_REDIS_HOST}:${PRISMALENS_REDIS_PORT}/${PRISMALENS_REDIS_DB}`;
}

/**
 * Build Redis connection options object from structured config.
 * Returns a plain object compatible with ioredis RedisOptions.
 */
export function buildRedisOptions(config: QueueConfig): RedisConnectionOptions {
	const base: RedisConnectionOptions = {
		host: config.PRISMALENS_REDIS_HOST,
		port: config.PRISMALENS_REDIS_PORT,
		username: config.PRISMALENS_REDIS_USERNAME || undefined,
		password: config.PRISMALENS_REDIS_PASSWORD || undefined,
		db: config.PRISMALENS_REDIS_DB,
	};

	if (!config.PRISMALENS_REDIS_TLS) {
		return base;
	}

	const ca = config.PRISMALENS_REDIS_CA
		? readCaCertificate(config.PRISMALENS_REDIS_CA)
		: undefined;

	return {
		...base,
		tls: ca ? { ca } : {},
	};
}

/**
 * Read a CA certificate file with proper error handling.
 * @throws {Error} If the file cannot be read
 */
function readCaCertificate(path: string): Buffer {
	try {
		return readFileSync(path);
	} catch (error) {
		throw new Error(
			`Failed to read Redis CA certificate at ${path}: ${(error as Error).message}`,
		);
	}
}
