import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";

// =============================================================================
// POSTGRESQL CHECKPOINTER FOR LANGGRAPH
// =============================================================================
// Provides durable execution for LangGraph workflows using PostgreSQL.
// Uses the same database as the API with a dedicated 'langgraph' schema.
//
// Features:
// - Singleton pattern for connection pooling
// - Thread ID generation for investigations
// - Resume support for failed investigations
// =============================================================================

let checkpointerInstance: PostgresSaver | null = null;
let poolInstance: pg.Pool | null = null;

export interface CheckpointerConfig {
	/** PostgreSQL connection string (defaults to DATABASE_URL env var) */
	connectionString?: string;
	/** Schema name for LangGraph tables (defaults to 'langgraph') */
	schema?: string;
	/** Maximum pool connections (defaults to 10) */
	maxPoolSize?: number;
}

/**
 * Get or create the PostgresSaver checkpointer instance.
 * Uses a singleton pattern to share the connection pool across invocations.
 *
 * @example
 * const checkpointer = await getCheckpointer();
 * const graph = builder.compile({ checkpointer });
 */
export async function getCheckpointer(
	config?: CheckpointerConfig,
): Promise<PostgresSaver> {
	if (checkpointerInstance) {
		return checkpointerInstance;
	}

	const connectionString = config?.connectionString || process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error(
			"DATABASE_URL environment variable is required for PostgresSaver. " +
				"Set it to your PostgreSQL connection string.",
		);
	}

	const schema = config?.schema || "langgraph";
	const maxPoolSize = config?.maxPoolSize || 10;

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
	checkpointerInstance = new PostgresSaver(poolInstance, {
		schema,
	} as any); // Type assertion due to potential version mismatch

	// Setup tables (creates them if they don't exist)
	try {
		await checkpointerInstance.setup();
	} catch (error) {
		// Log but don't fail - tables might already exist
		console.warn(`Checkpointer setup warning: ${error}`);
	}

	return checkpointerInstance;
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
 * @example
 * const config = getInvocationConfig('abc123');
 * const result = await graph.invoke(state, config);
 */
export function getInvocationConfig(
	investigationId: string,
	incidentId?: string,
) {
	return {
		configurable: {
			thread_id: getThreadId(investigationId),
			checkpoint_ns: "prismalens",
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
	if (poolInstance) {
		await poolInstance.end();
		poolInstance = null;
		checkpointerInstance = null;
	}
}

// Graceful shutdown handling
const shutdown = async () => {
	console.log("[Checkpointer] Closing connections...");
	await closeCheckpointer();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
