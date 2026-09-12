// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { z } from "zod";
import { SecretEnvVars } from "../utils/secrets.js";

/**
 * Deployment configuration schema.
 * Stores SQLite database, encryption keys, logs, and config.
 */
export const deploymentSchema = z.object({
	PRISMALENS_WORKSPACE_DIR: z
		.string()
		.optional()
		.describe(
			"Path where Prismalens stores user-specific data. Directory stores database file and encryption keys. " +
				"Defaults to user home directory if not specified. " +
				"Example: /var/prismalens or /home/user/.custom-prismalens",
		),
	PRISMALENS_PATH: z
		.string()
		.optional()
		.describe(
			"Path to .prismalens directory where CLI stores application files (logs, config, cached data). " +
				"Defaults to ~/.prismalens if not specified.",
		),
	[SecretEnvVars.ENCRYPTION_KEY]: z
		.string()
		.optional()
		.describe(
			"Hex-encoded 32-byte (64 hex chars) encryption key for encrypting sensitive data at rest. " +
				"If not set, random key will be generated (not recommended for production).",
		),
	// Authentication (Better Auth)
	[SecretEnvVars.AUTH_SECRET]: z
		.string()
		.min(
			32,
			`${SecretEnvVars.AUTH_SECRET} must be at least 32 characters when set`,
		)
		.optional()
		.describe(
			"Secret for Better Auth session signing. " +
				"Auto-generated and persisted to ~/.prismalens/ if not set.",
		),
});

export type DeploymentConfig = z.infer<typeof deploymentSchema>;
