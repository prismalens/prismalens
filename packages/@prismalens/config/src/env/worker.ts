// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";

/**
 * Configuration for the per-run investigation child process.
 * Used by that child only (not merged into API's baseConfigSchema).
 */
export const workerSchema = z.object({
	PRISMALENS_WORKER_API_URL: z
		.string()
		.url("PRISMALENS_WORKER_API_URL must be a valid URL")
		.default("http://localhost:5367/api")
		.describe("API URL the investigation child uses for oRPC calls"),
});

export type WorkerConfig = z.infer<typeof workerSchema>;
