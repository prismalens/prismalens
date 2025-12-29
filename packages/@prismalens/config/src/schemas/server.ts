import { z } from 'zod';

/**
 * Server configuration schema.
 */
export const serverSchema = z.object({
  PRISMALENS_SERVER_PORT: z.coerce
    .number()
    .default(5367)
    .describe('API server port')
});

export type ServerConfig = z.infer<typeof serverSchema>;
