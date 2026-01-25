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
 * ### LLM Provider Metadata (`@prismalens/config/llm`)
 * - `LLM_PROVIDERS` - Static provider metadata
 * - `llmProviderIdSchema` - Zod schema for provider IDs
 * - Provider-specific config schemas
 *
 * ### Browser-Safe (`@prismalens/config/browser`)
 * - Subset safe for frontend use (no Node.js dependencies)
 *
 * @example
 * ```typescript
 * // Environment config
 * import { getConfig } from '@prismalens/config';
 * const config = getConfig();
 *
 * // LLM metadata
 * import { LLM_PROVIDERS } from '@prismalens/config/llm';
 * ```
 */

import { z } from "zod";
import {
	databaseSchema,
	deploymentSchema,
	globalSchema,
	langsmithSchema,
	llmEnvSchema,
	loggingSchema,
	queueSchema,
	skillsSchema,
} from "./schemas/index.js";
import { ensureAppDataDir, getAppDataDir } from "./utils/app-data.js";
import { buildDatabaseUrl } from "./utils/database-url.js";
import {
	generateEncryptionKey,
	getEncryptionKeyPath,
	getOrCreateEncryptionKey,
	isValidEncryptionKey,
} from "./utils/encryption-key.js";

export * from "./env.js";
// Re-export all schemas
export * from "./schemas/index.js";

// Re-export app data utilities
export { getAppDataDir, ensureAppDataDir };

// Re-export encryption key utilities
export {
	generateEncryptionKey,
	getEncryptionKeyPath,
	getOrCreateEncryptionKey,
	isValidEncryptionKey,
};

/**
 * Composed global configuration schema.
 * Merges all domain-specific schemas into a single validated config.
 */
const baseConfigSchema = globalSchema
	.merge(deploymentSchema)
	.merge(databaseSchema)
	.merge(queueSchema)
	.merge(loggingSchema)
	.merge(llmEnvSchema)
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
		// Auto-generate encryption key if not set (following n8n's _FILE suffix pattern)
		if (
			!process.env.PRISMALENS_ENCRYPTION_KEY &&
			!process.env.PRISMALENS_ENCRYPTION_KEY_FILE
		) {
			process.env.PRISMALENS_ENCRYPTION_KEY = getOrCreateEncryptionKey();
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

/**
 * Validate configuration without caching.
 * Useful for testing or checking config before startup.
 *
 * @returns Validation result with success flag and data/errors
 */
export function validateConfig(): z.SafeParseReturnType<unknown, GlobalConfig> {
	const result = baseConfigSchema
		.omit({ PRISMALENS_DB_URL: true })
		.safeParse(process.env);

	if (!result.success) {
		return result;
	}

	const baseConfig = result.data;
	const databaseUrl = buildDatabaseUrl(baseConfig);

	return {
		success: true,
		data: {
			...baseConfig,
			PRISMALENS_DB_URL: databaseUrl,
		},
	} as z.SafeParseReturnType<unknown, GlobalConfig>;
}

/**
 * Reset cached config. Useful for testing.
 */
export function resetConfig(): void {
	_config = null;
}

export type EnvironmentVariables = z.infer<typeof baseConfigSchema>;
