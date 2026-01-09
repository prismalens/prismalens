import { z } from 'zod';

/**
 * Server configuration schema.
 */
export const globalSchema = z.object({
  PRISMALENS_HOST: z.coerce
    .string()
    .default('0.0.0.0')
    .describe('Prismalens server host'),
  PRISMALENS_PORT: z.coerce
    .number()
    .default(5367)
    .describe('Prismalens server port'),
  PRISMALENS_PATH: z.coerce
    .string()
    .optional()
    .describe('The path Prismalens deploys to. Useful for reverse proxy setups when Prismalens becomes a web service.'),
  PRISMALENS_PROTOCOL: z
    .enum(['http', 'https'])
    .default('http')
    .describe('HTTP Protocol via which Prismalens can be reached'),
  PRISMALENS_SSL_KEY: z
    .string()
    .optional()
    .describe('SSL key for HTTPS protocol'),
  PRISMALENS_SSL_CERT: z
    .string()
    .optional()
    .describe('SSL cert for HTTPS protocol'),
  PRISMALENS_DASHBOARD_BASE_URL: z
    .string()
    .optional()
    .describe('Public URL where the dashboard is accessible. Also used for emails sent from Prismalens.'),
  PRISMALENS_CORS_ORIGIN: z
    .string()
    .optional()
    .describe('Allowed CORS origins for dashboard API (comma-separated). Defaults to PRISMALENS_DASHBOARD_BASE_URL + localhost:3000'),
  PRISMALENS_CORS_WEBHOOK_OPEN: z.coerce
    .boolean()
    .default(true)
    .describe('Allow any origin for webhook endpoints (for browser-based testing tools)'),
});

export type GlobalConfig = z.infer<typeof globalSchema>;
