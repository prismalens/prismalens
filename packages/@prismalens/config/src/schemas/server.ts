import { z } from 'zod';

/**
 * Server configuration schema.
 */
export const serverSchema = z.object({
  PRISMALENS_SERVER_PORT: z.coerce
    .number()
    .default(5367)
    .describe('API server port'),
  PRISMALENS_INTERNAL_SECRET: z
    .string()
    .default('dev-secret-replace-in-prod')
    .describe('Shared secret for internal API communication'),
});

export type ServerConfig = z.infer<typeof serverSchema>;
