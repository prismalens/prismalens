import { z } from "zod";

/**
 * Global configuration schema.
 * Contains API server binding, public URLs, and security settings.
 */
export const globalSchema = z.object({
	// API Internal Binding
	PRISMALENS_HOST: z.coerce
		.string()
		.default("0.0.0.0")
		.describe("API server bind address"),
	PRISMALENS_PORT: z.coerce
		.number()
		.default(3001)
		.describe("API server port (internal, behind reverse proxy)"),
	PRISMALENS_PROTOCOL: z
		.enum(["http", "https"])
		.default("http")
		.describe("API protocol (use http when behind Caddy reverse proxy)"),
	PRISMALENS_SSL_KEY: z
		.string()
		.optional()
		.describe("SSL key path (only for direct API access without proxy)"),
	PRISMALENS_SSL_CERT: z
		.string()
		.optional()
		.describe("SSL cert path (only for direct API access without proxy)"),

	// Public URLs (what external services/users see)
	PRISMALENS_PUBLIC_URL: z
		.string()
		.optional()
		.describe(
			"Public URL where PrismaLens is accessible (e.g., https://prismalens.example.com). Used for OAuth callbacks and emails.",
		),
	PRISMALENS_WEBHOOK_URL: z
		.string()
		.optional()
		.describe(
			"Public URL for webhook callbacks (defaults to PRISMALENS_PUBLIC_URL if not set)",
		),
	PRISMALENS_DOMAIN: z
		.string()
		.optional()
		.describe(
			"Domain for SSL certificate (used by Caddy reverse proxy for Let's Encrypt)",
		),

	// CORS / Security
	PRISMALENS_WEBHOOK_SECRET: z
		.string()
		.min(16, "Webhook secret must be at least 16 characters")
		.optional()
		.describe(
			"Optional shared secret for webhook HMAC-SHA256 signature verification. " +
				"When set, incoming webhooks must include a valid X-Hub-Signature-256 header.",
		),

	PRISMALENS_CORS_ORIGIN: z
		.string()
		.optional()
		.describe(
			"Allowed CORS origins for API (comma-separated). Defaults to PRISMALENS_PUBLIC_URL + localhost:3000",
		),
	PRISMALENS_CORS_WEBHOOK_OPEN: z.coerce
		.boolean()
		.default(true)
		.describe(
			"Allow any origin for webhook endpoints (for browser-based testing tools)",
		),
});

export type ServerConfig = z.infer<typeof globalSchema>;
