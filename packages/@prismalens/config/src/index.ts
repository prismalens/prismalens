// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * @prismalens/config
 *
 * Centralized configuration management for PrismaLens monorepo.
 *
 * ## Available Exports
 *
 * ### Environment Configuration (this module)
 * - `getConfig()` - Validated environment variables
 * - `validateConfig()` - Config validation without caching
 * - Environment schemas (globalSchema, databaseSchema, etc.)
 *
 */

import { z } from "zod";
import {
	databaseSchema,
	deploymentSchema,
	dispatchSchema,
	globalSchema,
	langsmithSchema,
	loggingSchema,
	skillsSchema,
} from "./env/index.js";
import { ensureAppDataDir, getAppDataDir } from "./utils/app-data.js";
import { buildDatabaseUrl } from "./utils/database-url.js";
import {
	generateEncryptionKey,
	getOrCreateAuthSecret,
	getOrCreateEncryptionKey,
} from "./utils/encryption-key.js";
import { FILE_SUFFIX, SecretEnvVars } from "./utils/secrets.js";

// Re-export env readers and all env schemas
export * from "./env/index.js";
export type {
	HarnessSelection,
	HarnessSelectionFailure,
	HarnessSelectionInput,
	HarnessStatus,
} from "./harness-selection.js";
// Detect-and-report harness selection (ADR 0003 §9)
export {
	isOnPath,
	listHarnessStatus,
	resolveHarnessSelection,
} from "./harness-selection.js";
export type { SecretEnvVar } from "./utils/secrets.js";
// Re-export secret constants
export { FILE_SUFFIX, SecretEnvVars, secretFileName } from "./utils/secrets.js";
// Re-export app data utilities
// Re-export encryption key and secret utilities
export {
	ensureAppDataDir,
	generateEncryptionKey,
	getAppDataDir,
	getOrCreateAuthSecret,
	getOrCreateEncryptionKey,
};

/**
 * Composed global configuration schema.
 * Merges all domain-specific schemas into a single validated config.
 */
const baseConfigSchema = globalSchema
	.merge(deploymentSchema)
	.merge(databaseSchema)
	.merge(dispatchSchema)
	.merge(loggingSchema)
	.merge(skillsSchema)
	.merge(langsmithSchema)
	.extend({
		PRISMALENS_DB_URL: z.string().describe("Computed database connection URL"),
	});

/**
 * Type-safe global configuration.
 */
export type GlobalConfig = z.infer<typeof baseConfigSchema>;

// Cached config instance
let _config: GlobalConfig | null = null;

/**
 * Get validated global configuration.
 * Validates all environment variables against schemas, computes database URL, and caches the result.
 *
 * @throws {Error} If validation fails with details about invalid/missing vars
 * @returns Validated configuration object with computed DATABASE_URL
 */
export function getConfig(): GlobalConfig {
	if (!_config) {
		// Resolve secrets before Zod validation (auto-generate and persist if not set)
		if (
			!process.env[SecretEnvVars.ENCRYPTION_KEY] &&
			!process.env[`${SecretEnvVars.ENCRYPTION_KEY}${FILE_SUFFIX}`]
		) {
			process.env[SecretEnvVars.ENCRYPTION_KEY] = getOrCreateEncryptionKey();
		}
		if (!process.env[SecretEnvVars.AUTH_SECRET]) {
			process.env[SecretEnvVars.AUTH_SECRET] = getOrCreateAuthSecret();
		}

		const result = baseConfigSchema
			.omit({ PRISMALENS_DB_URL: true })
			.safeParse(process.env);

		if (!result.success) {
			console.error("\n❌ Configuration validation failed:\n");
			result.error.issues.forEach((issue) => {
				const path = issue.path.join(".");
				console.error(`  • ${path}: ${issue.message}`);
			});
			console.error("\n");
			throw new Error("Invalid configuration. Check environment variables.");
		}

		const baseConfig = result.data;

		// Compute database URL based on configuration
		const databaseUrl = buildDatabaseUrl(baseConfig);

		// Combine base config with computed database URL
		_config = {
			...baseConfig,
			PRISMALENS_DB_URL: databaseUrl,
		};
	}

	return _config;
}

export type EnvironmentVariables = z.infer<typeof baseConfigSchema>;

/**
 * Reset cached global config. Useful for testing.
 */
export function resetConfig(): void {
	_config = null;
}
