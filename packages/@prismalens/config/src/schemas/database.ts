import { z } from 'zod';

/**
 * Database type configuration.
 */
const dbTypeSchema = z.enum(['sqlite', 'postgresql']).default('sqlite');
export type DbType = z.infer<typeof dbTypeSchema>;

/**
 * SQLite database configuration.
 * Database file path is hardcoded to .prismalens/prismalens.db
 * Configuration focuses on better-sqlite3 library options.
 */
export const sqliteConfigSchema = z.object({
  PRISMALENS_DB_SQLITE_READONLY: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .default('false')
    .describe('Open SQLite database connection in readonly mode'),
  PRISMALENS_DB_SQLITE_FILE_MUST_EXIST: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .default('false')
    .describe('Throw error if SQLite database file does not exist'),
  PRISMALENS_DB_SQLITE_TIMEOUT: z.coerce
    .number()
    .default(5000)
    .describe('Milliseconds to wait when executing queries on locked database'),
});

export type SqliteConfig = z.infer<typeof sqliteConfigSchema>;

/**
 * PostgreSQL database configuration.
 */
export const postgresConfigSchema = z.object({
  PRISMALENS_DB_POSTGRES_HOST: z
    .string()
    .default('localhost')
    .describe('PostgreSQL host'),
  PRISMALENS_DB_POSTGRES_PORT: z.coerce
    .number()
    .default(5432)
    .describe('PostgreSQL port'),
  PRISMALENS_DB_POSTGRES_DATABASE: z
    .string()
    .default('prismalens')
    .describe('PostgreSQL database name'),
  PRISMALENS_DB_POSTGRES_USER: z
    .string()
    .default('postgres')
    .describe('PostgreSQL user'),
  PRISMALENS_DB_POSTGRES_PASSWORD: z
    .string()
    .default('')
    .describe('PostgreSQL password'),
  PRISMALENS_DB_POSTGRES_SCHEMA: z
    .string()
    .default('public')
    .describe('PostgreSQL schema'),
  PRISMALENS_DB_POSTGRES_POOL_SIZE: z.coerce
    .number()
    .min(1)
    .default(10)
    .describe('PostgreSQL connection pool size'),
  PRISMALENS_DB_POSTGRES_SSL_ENABLED: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .default('false')
    .describe('Enable SSL for PostgreSQL connection'),
  PRISMALENS_DB_POSTGRES_SSL_CA: z
    .string()
    .optional()
    .describe('PostgreSQL SSL CA certificate'),
  PRISMALENS_DB_POSTGRES_SSL_CERT: z
    .string()
    .optional()
    .describe('PostgreSQL SSL certificate'),
  PRISMALENS_DB_POSTGRES_SSL_KEY: z
    .string()
    .optional()
    .describe('PostgreSQL SSL key'),
  PRISMALENS_DB_POSTGRES_SSL_REJECT_UNAUTHORIZED: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .default('true')
    .describe('Reject unauthorized SSL connections'),
});

export type PostgresConfig = z.infer<typeof postgresConfigSchema>;

/**
 * Database configuration schema.
 * Supports SQLite (default) and PostgreSQL.
 * Includes app data directory configuration for proper data storage.
 */
export const databaseSchema = z.object({
  PRISMALENS_DB_TYPE: dbTypeSchema.describe('Database type (sqlite or postgresql)'),
  ...sqliteConfigSchema.shape,
  ...postgresConfigSchema.shape,
});

export type DatabaseConfig = z.infer<typeof databaseSchema>;
