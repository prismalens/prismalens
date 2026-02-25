/**
 * Checkpointer factory — creates a BaseCheckpointSaver for the configured database type.
 *
 * - PostgreSQL: PostgresSaver.fromConnString() + .setup()
 * - SQLite: SqliteSaver.fromConnString()
 */

import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint"

export interface CheckpointerOptions {
  /** Database type: "postgresql" or "sqlite" */
  dbType: "postgresql" | "sqlite"
  /** Connection string (PG URL or SQLite file path) */
  connectionString: string
  /** PostgreSQL schema name for checkpoint tables (PG only, defaults to "public") */
  schema?: string
}

/**
 * Create a checkpoint saver for LangGraph state persistence.
 *
 * PostgreSQL: creates tables on first call via .setup().
 * SQLite: file-based persistent checkpoints.
 */
export async function createCheckpointer(
  options: CheckpointerOptions,
): Promise<BaseCheckpointSaver> {
  if (options.dbType === "postgresql") {
    const { PostgresSaver } = await import(
      "@langchain/langgraph-checkpoint-postgres"
    )
    const saver = PostgresSaver.fromConnString(options.connectionString)
    try {
      await saver.setup()
    } catch (error) {
      // Clean up the connection pool if setup fails (e.g., insufficient permissions)
      await (saver as unknown as { end?: () => Promise<void> }).end?.().catch(() => {})
      throw error
    }
    return saver
  }

  const { SqliteSaver } = await import(
    "@langchain/langgraph-checkpoint-sqlite"
  )
  return SqliteSaver.fromConnString(options.connectionString)
}
