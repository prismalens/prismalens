import { z } from 'zod';

/**
 * Frontend configuration schema.
 * Variables prefixed with NEXT_PUBLIC_ are exposed to the browser.
 */
export const frontendSchema = z.object({
  PRISMALENS_CLIENT_PORT: z.coerce
    .number()
    .default(5368)
    .describe('Frontend server port')
});

export type FrontendConfig = z.infer<typeof frontendSchema>;
