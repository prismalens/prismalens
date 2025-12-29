/**
 * @prismalens/config
 *
 * Centralized configuration management for PrismaLens monorepo.
 * Provides type-safe environment variable validation using Zod schemas.
 *
 * @example
 * ```typescript
 * import { getConfig } from '@prismalens/config';
 *
 * const config = getConfig();
 * console.log(config.PRISMALENS_EDITION); // 'COMMUNITY' | 'ENTERPRISE'
 * console.log(config.DATABASE_URL);
 * ```
 */

import { z } from 'zod';

// Import schemas
import { databaseSchema } from './schemas/database.js';
import { llmSchema, validateLLMConfig } from './schemas/llm.js';
import { serverSchema } from './schemas/server.js';
import { frontendSchema } from './schemas/client.js';
import { integrationsSchema } from './schemas/integrations.js';
import { buildDatabaseUrl } from './utils/database-url.js';

// Re-export all schemas
export * from './schemas/index.js';
export * from './env.js';

/**
 * Composed global configuration schema.
 * Merges all domain-specific schemas into a single validated config.
 */
const baseConfigSchema = databaseSchema
  .merge(llmSchema)
  .merge(serverSchema)
  .merge(frontendSchema)
  .merge(integrationsSchema)
  .extend({
    PRISMALENS_DB_URL: z.string().describe('Computed database connection URL'),
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
    const result = baseConfigSchema.omit({ PRISMALENS_DB_URL: true }).safeParse(process.env);

    if (!result.success) {
      console.error('\n❌ Configuration validation failed:\n');
      result.error.issues.forEach((issue) => {
        const path = issue.path.join('.');
        console.error(`  • ${path}: ${issue.message}`);
      });
      console.error('\n');
      throw new Error('Invalid configuration. Check environment variables.');
    }

    const baseConfig = result.data;

    // Compute database URL based on configuration
    const databaseUrl = buildDatabaseUrl(baseConfig);

    // Combine base config with computed database URL
    _config = {
      ...baseConfig,
      PRISMALENS_DB_URL: databaseUrl,
    };

    // Additional validation: ensure at least one LLM key is provided
    if (!validateLLMConfig(_config)) {
      console.warn(
        '\n⚠️  Warning: No LLM API key configured. Set one of: GOOGLE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or AZURE_API_KEY\n',
      );
    }
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
  const result = baseConfigSchema.omit({ PRISMALENS_DB_URL: true }).safeParse(process.env);

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
