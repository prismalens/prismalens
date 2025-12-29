import { z } from 'zod';

/**
 * External integrations configuration schema.
 */
export const integrationsSchema = z.object({
  // GitHub
  GITHUB_TOKEN: z
    .string()
    .optional()
    .describe('GitHub personal access token for code analysis'),

  // Render.com
  RENDER_API_TOKEN: z
    .string()
    .optional()
    .describe('Render.com API token for log retrieval'),
  RENDER_OWNER_ID: z
    .string()
    .optional()
    .describe('Render.com owner ID'),
  RENDER_RESOURCE_ID: z
    .string()
    .optional()
    .describe('Render.com resource ID'),

  // Qdrant (Vector Store)
  QDRANT_HOST: z
    .string()
    .default('localhost')
    .describe('Qdrant vector store host'),
  QDRANT_PORT: z.coerce
    .number()
    .default(6333)
    .describe('Qdrant vector store port'),
});

export type IntegrationsConfig = z.infer<typeof integrationsSchema>;
