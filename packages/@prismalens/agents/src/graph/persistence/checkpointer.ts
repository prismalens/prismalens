import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type {
	BaseCheckpointSaver,
	Checkpoint,
	CheckpointTuple,
} from "@langchain/langgraph-checkpoint";
import pg from "pg";
import { resolve } from "node:path";
import { getConfig } from "@prismalens/config";
import { Logger } from "@prismalens/logger";
import type { InvestigationConfig } from "../../types/config.js";

const logger = new Logger({ context: "Checkpointer" });

// =============================================================================
// CHECKPOINTER FOR LANGGRAPH (PostgreSQL + SQLite Support)
// =============================================================================
// Provides durable execution for LangGraph workflows using PostgreSQL or SQLite.
// Uses the same database configuration as the API (@prismalens/config).
//
// Features:
// - Auto-detects database type from PRISMALENS_DB_TYPE
// - Singleton pattern for connection pooling
// - Thread ID generation for investigations
// - Resume support for failed investigations
// - SQLite fallback for self-hosted users without PostgreSQL
// =============================================================================

let checkpointerInstance: BaseCheckpointSaver | null = null;
let checkpointerInitPromise: Promise<BaseCheckpointSaver> | null = null;
let poolInstance: pg.Pool | null = null;

export interface CheckpointerConfig {
	/** Override connection string (defaults to PRISMALENS_DB_URL) */
	connectionString?: string;
	/** Schema name for LangGraph tables (PostgreSQL only, defaults to 'langgraph') */
	schema?: string;
	/** Maximum pool connections (PostgreSQL only, defaults to 10) */
	maxPoolSize?: number;
}

/**
 * Get or create the checkpointer instance.
 * Uses a singleton pattern to share the connection pool across invocations.
 * Automatically selects PostgresSaver or SqliteSaver based on PRISMALENS_DB_TYPE.
 *
 * @example
 * const checkpointer = await getCheckpointer();
 * const graph = builder.compile({ checkpointer });
 */
export async function getCheckpointer(
	config?: CheckpointerConfig,
): Promise<BaseCheckpointSaver> {
	if (checkpointerInstance) {
		return checkpointerInstance;
	}

	// Promise-based lock: if initialization is already in progress, wait for it
	if (checkpointerInitPromise) {
		return checkpointerInitPromise;
	}

	checkpointerInitPromise = initializeCheckpointer(config);

	try {
		const instance = await checkpointerInitPromise;
		checkpointerInstance = instance;
		return instance;
	} catch (error) {
		// Reset promise so next call retries
		checkpointerInitPromise = null;
		throw error;
	}
}

async function initializeCheckpointer(
	config?: CheckpointerConfig,
): Promise<BaseCheckpointSaver> {
	// Use same config as Prisma (from @prismalens/config)
	const appConfig = getConfig();
	const dbType = appConfig.PRISMALENS_DB_TYPE;
	const connectionString = config?.connectionString || appConfig.PRISMALENS_DB_URL;

	if (dbType === "postgresql") {
		return createPostgresCheckpointer(
			connectionString,
			config?.schema,
			config?.maxPoolSize,
		);
	}

	return createSqliteCheckpointer(connectionString);
}

/**
 * Create PostgreSQL checkpointer with connection pooling.
 */
async function createPostgresCheckpointer(
	connectionString: string,
	schema = "langgraph",
	maxPoolSize = 10,
): Promise<PostgresSaver> {
	// Create connection pool
	poolInstance = new pg.Pool({
		connectionString,
		max: maxPoolSize,
		// Connection timeout (10 seconds)
		connectionTimeoutMillis: 10000,
		// Idle timeout (30 seconds)
		idleTimeoutMillis: 30000,
	});

	// Test connection
	try {
		const client = await poolInstance.connect();
		client.release();
	} catch (error) {
		await poolInstance.end();
		poolInstance = null;
		throw new Error(
			`Failed to connect to PostgreSQL for checkpointing: ${error}`,
		);
	}

	// Create checkpointer with schema
	const checkpointer = new PostgresSaver(poolInstance, {
		schema,
	} as { schema: string });

	// Setup tables (creates them if they don't exist)
	try {
		await checkpointer.setup();
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		// Only swallow "already exists" errors — re-throw real errors
		if (errMsg.includes("already exists") || errMsg.includes("duplicate")) {
			logger.info("Checkpointer tables already exist");
		} else {
			throw error;
		}
	}

	return checkpointer;
}

/**
 * Create SQLite checkpointer.
 * Auto-creates tables on first use.
 */
async function createSqliteCheckpointer(
	connectionString: string,
): Promise<SqliteSaver> {
	// SqliteSaver.fromConnString expects a file path, not a full connection string
	// Extract the file path from the connection string if needed
	let dbPath = connectionString;

	// Handle Prisma-style SQLite URLs: file:./path/to/db.sqlite
	if (connectionString.startsWith("file:")) {
		dbPath = connectionString.replace(/^file:/, "");
	}

	// Validate path to prevent traversal attacks
	const resolvedPath = resolve(dbPath);
	const baseDir = resolve(process.cwd());
	if (resolvedPath !== baseDir && !resolvedPath.startsWith(`${baseDir}/`)) {
		throw new Error(
			`SQLite path must be within the working directory: ${resolvedPath} is outside ${baseDir}`,
		);
	}

	const checkpointer = SqliteSaver.fromConnString(resolvedPath);

	return checkpointer;
}

/**
 * Generate a unique thread ID for an investigation.
 * Format: investigation-{investigationId}
 *
 * @example
 * const threadId = getThreadId('abc123');
 * // Returns: 'investigation-abc123'
 */
export function getThreadId(investigationId: string): string {
	return `investigation-${investigationId}`;
}

/**
 * Get LangGraph invocation config with thread ID for persistence.
 * Includes root-level trace configuration for LangSmith.
 *
 * IMPORTANT: Runtime config (llmConfig, integrations, maxIterations, priority)
 * is passed via configurable but is NOT serialized to checkpoints.
 * This prevents credentials from being persisted.
 *
 * @example
 * const config = getInvocationConfig('abc123', {
 *   llmConfig: { provider: 'anthropic', model: 'claude-sonnet-4', apiKey: '...' },
 *   integrations: [...],
 *   maxIterations: 10,
 *   priority: 'normal',
 * }, 'inc-456');
 * const result = await graph.invoke(state, config);
 */
export function getInvocationConfig(
	investigationId: string,
	runtimeConfig?: InvestigationConfig,
	incidentId?: string,
) {
	return {
		configurable: {
			thread_id: getThreadId(investigationId),
			checkpoint_ns: "prismalens",
			// Runtime config - passed to nodes but NOT checkpointed
			// (Checkpointers only serialize thread_id and checkpoint_ns)
			...(runtimeConfig && {
				llmConfig: runtimeConfig.llmConfig,
				integrations: runtimeConfig.integrations,
				maxIterations: runtimeConfig.maxIterations ?? 10,
				priority: runtimeConfig.priority ?? "normal",
			}),
		},
		// Root-level trace configuration for LangSmith
		runName: `Investigation ${investigationId.slice(0, 8)}`,
		tags: ["prismalens", "investigation", `inv:${investigationId}`],
		metadata: {
			investigationId,
			...(incidentId && { incidentId }),
			startedAt: new Date().toISOString(),
		},
	};
}

/**
 * Check if an investigation has existing checkpoints (can be resumed).
 *
 * @example
 * const canResume = await hasExistingCheckpoint('abc123');
 * if (canResume) {
 *   console.log('Resuming from checkpoint...');
 * }
 */
export async function hasExistingCheckpoint(
	investigationId: string,
): Promise<boolean> {
	const checkpointer = await getCheckpointer();
	const threadId = getThreadId(investigationId);

	try {
		const checkpoint = await checkpointer.get({
			configurable: { thread_id: threadId },
		});
		return checkpoint !== null;
	} catch {
		return false;
	}
}

/**
 * Get the latest checkpoint for an investigation (for resuming).
 *
 * @example
 * const checkpoint = await getCheckpoint('abc123');
 * if (checkpoint) {
 *   // Resume from checkpoint
 * }
 */
export async function getCheckpoint(investigationId: string) {
	const checkpointer = await getCheckpointer();
	const threadId = getThreadId(investigationId);

	return checkpointer.get({
		configurable: { thread_id: threadId },
	});
}

/**
 * List all checkpoints for an investigation (for debugging/auditing).
 *
 * @example
 * const history = await listCheckpoints('abc123');
 * for (const cp of history) {
 *   console.log(cp.ts, cp.id);
 * }
 */
export async function listCheckpoints(investigationId: string) {
	const checkpointer = await getCheckpointer();
	const threadId = getThreadId(investigationId);

	const checkpoints = [];
	for await (const checkpoint of checkpointer.list({
		configurable: { thread_id: threadId },
	})) {
		checkpoints.push(checkpoint);
	}
	return checkpoints;
}

/**
 * Close the checkpointer and release all connections.
 * Call this during graceful shutdown.
 *
 * @example
 * process.on('SIGTERM', async () => {
 *   await closeCheckpointer();
 *   process.exit(0);
 * });
 */
export async function closeCheckpointer(): Promise<void> {
	if (!checkpointerInstance) return;

	// PostgresSaver has a pool that needs cleanup
	if (poolInstance) {
		await poolInstance.end();
		poolInstance = null;
	}

	// SqliteSaver may have a close method depending on version
	const instance = checkpointerInstance as Record<string, unknown>;
	if ("close" in instance && typeof instance.close === "function") {
		await (instance.close as () => Promise<void>)();
	}

	checkpointerInstance = null;
	checkpointerInitPromise = null;
}

/**
 * Reset the checkpointer instance (for testing).
 * Does NOT close connections - use closeCheckpointer() for that.
 */
export function resetCheckpointer(): void {
	checkpointerInstance = null;
	checkpointerInitPromise = null;
	poolInstance = null;
}

// =============================================================================
// CHECKPOINT STATE HELPERS (Type-Safe Access)
// =============================================================================

/**
 * Extract state from a checkpoint with proper typing.
 * LangGraph stores state in channel_values, not a top-level 'values' property.
 *
 * @param checkpoint - The checkpoint or checkpoint tuple from getCheckpoint/listCheckpoints
 * @returns The extracted state, or undefined if not available
 *
 * @example
 * const checkpoint = await getCheckpoint('abc123');
 * const state = getStateFromCheckpoint<InvestigationState>(checkpoint);
 */
export function getStateFromCheckpoint<T>(
	checkpoint: Checkpoint | CheckpointTuple | null | undefined,
): T | undefined {
	if (!checkpoint) return undefined;

	// CheckpointTuple has .checkpoint property, raw Checkpoint doesn't
	const cp = "checkpoint" in checkpoint ? checkpoint.checkpoint : checkpoint;

	// State is stored in channel_values under various possible keys
	const channelValues = cp?.channel_values;
	if (!channelValues) return undefined;

	// Try common channel names used by LangGraph
	// '__root__' is used for the root state channel
	// Some implementations also use 'state' or store directly
	const state =
		channelValues["__root__"] ?? channelValues["state"] ?? channelValues;

	return state as T | undefined;
}

/**
 * Get checkpoint timestamp with proper typing.
 *
 * @param checkpoint - The checkpoint or checkpoint tuple
 * @returns ISO timestamp string, or undefined if not available
 *
 * @example
 * const checkpoint = await getCheckpoint('abc123');
 * const ts = getCheckpointTimestamp(checkpoint);
 * // Returns: '2024-01-15T10:30:00.000Z'
 */
export function getCheckpointTimestamp(
	checkpoint: Checkpoint | CheckpointTuple | null | undefined,
): string | undefined {
	if (!checkpoint) return undefined;

	// CheckpointTuple has .checkpoint property, raw Checkpoint doesn't
	const cp = "checkpoint" in checkpoint ? checkpoint.checkpoint : checkpoint;

	return cp?.ts;
}

// Graceful shutdown handling
const shutdown = async () => {
	try {
		logger.info("Closing connections...");
		await closeCheckpointer();
	} catch (error) {
		logger.error("Error during checkpointer shutdown", { error });
	}
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
