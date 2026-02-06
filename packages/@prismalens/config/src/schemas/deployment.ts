import { z } from "zod";

/**
 * Deployment configuration schema.
 * Stores SQLite database, encryption keys, logs, and config.
 */
export const deploymentSchema = z.object({
	PRISMALENS_USER_FOLDER: z
		.string()
		.optional()
		.describe(
			"Path where Prismalens stores user-specific data. Directory stores database file and encryption keys. " +
				"Defaults to user home directory if not specified. " +
				"Example: /var/prismalens or /home/user/.custom-prismalens",
		),
	PRISMALENS_PATH: z
		.string()
		.optional()
		.describe(
			"Path to .prismalens directory where CLI stores application files (logs, config, cached data). " +
				"Defaults to ~/.prismalens if not specified.",
		),
	PRISMALENS_ENCRYPTION_KEY: z
		.string()
		.optional()
		.describe(
			"Hex-encoded 32-byte (64 hex chars) encryption key for encrypting sensitive data at rest. " +
				"If not set, random key will be generated (not recommended for production).",
		),
	PRISMALENS_INTERNAL_SECRET: z
		.string()
		.default("dev-secret-replace-in-prod")
		.describe(
			"Shared secret for internal API communication. " +
				"Must be at least 32 characters in production (PRISMALENS_MODE=queue).",
		),

	// Authentication (Better Auth)
	BETTER_AUTH_SECRET: z
		.string()
		.min(32)
		.default("dev-secret-replace-in-production-min-32-chars")
		.describe(
			"Secret key for Better Auth session signing. Generate with: openssl rand -base64 32",
		),

	// SMTP Configuration (Optional - for email invitations)
	PRISMALENS_SMTP_HOST: z
		.string()
		.optional()
		.describe("SMTP server hostname for sending invitation emails"),
	PRISMALENS_SMTP_PORT: z
		.coerce.number()
		.default(587)
		.describe("SMTP server port (default: 587)"),
	PRISMALENS_SMTP_USER: z
		.string()
		.optional()
		.describe("SMTP authentication username"),
	PRISMALENS_SMTP_PASS: z
		.string()
		.optional()
		.describe("SMTP authentication password"),
	PRISMALENS_SMTP_FROM: z
		.string()
		.email()
		.optional()
		.describe("Email address to send invitations from"),
	PRISMALENS_SMTP_SECURE: z
		.preprocess((val) => val === "true" || val === true, z.boolean())
		.default(true)
		.describe("Use TLS for SMTP connection (default: true)"),

	PRISMALENS_MODE: z
		.enum(["regular", "queue"])
		.default("regular")
		.describe(
			"Investigation mode: regular (no Redis, HTTP dispatch) or queue (Redis-backed BullMQ)",
		),
});

export type DeploymentConfig = z.infer<typeof deploymentSchema>;
