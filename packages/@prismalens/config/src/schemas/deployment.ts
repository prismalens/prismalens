import { z } from 'zod';

/**
 * Deployment configuration schema.
 * Stores SQLite database, encryption keys, logs, and config.
 */
export const deploymentSchema = z.object({
  PRISMALENS_USER_FOLDER: z
    .string()
    .optional()
    .describe(
      'Path where Prismalens stores user-specific data. Directory stores database file and encryption keys. ' +
      'Defaults to user home directory if not specified. ' +
      'Example: /var/prismalens or /home/user/.custom-prismalens',
    ),
  PRISMALENS_PATH: z
    .string()
    .optional()
    .describe(
      '(Reserved for future use) The path Prismalens deploys to. Useful for reverse proxy setups when Prismalens becomes a web service.',
    ),
  PRISMALENS_ENCRYPTION_KEY: z
    .string()
    .optional()
    .describe(
      'Hex-encoded 32-byte (64 hex chars) encryption key for encrypting sensitive data at rest. ' +
      'If not set, random key will be generated (not recommended for production).',
    ),
  PRISMALENS_INTERNAL_SECRET: z
    .string()
    .default('dev-secret-replace-in-prod')
    .describe('Shared secret for internal API communication'),
  PRISMALENS_MODE: z
    .enum(['regular', 'queue'])
    .default('regular')
    .describe('Investigation mode: regular (no Redis, HTTP dispatch) or queue (Redis-backed BullMQ)'),
});

export type DeploymentConfig = z.infer<typeof deploymentSchema>;
