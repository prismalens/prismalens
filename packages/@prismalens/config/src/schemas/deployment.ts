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
});

export type DeploymentConfig = z.infer<typeof deploymentSchema>;
