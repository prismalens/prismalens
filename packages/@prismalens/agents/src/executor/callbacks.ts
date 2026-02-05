import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type {
	AgentExecutionRecord,
	ToolExecutionRecord,
} from "../types/index.js";

// =============================================================================
// EXECUTION TRACKER MIDDLEWARE
// =============================================================================
// Tracks agent and tool executions for database persistence.
// Collects execution metrics, timing, and results for the Investigation record.
// =============================================================================

export interface ExecutionTrackerOptions {
	/** Called when an agent execution starts */
	onAgentStart?: (agentName: string) => void;
	/** Called when an agent execution completes */
	onAgentEnd?: (execution: AgentExecutionRecord) => void;
	/** Called when a tool execution completes */
	onToolEnd?: (execution: ToolExecutionRecord) => void;
}

/**
 * Execution tracker that collects agent and tool execution records.
 * These records are later written to the database via the API writer node.
 */
export class ExecutionTracker {
	private agentExecutions: AgentExecutionRecord[] = [];
	private currentAgentExecution: AgentExecutionRecord | null = null;
	private currentToolExecutions: ToolExecutionRecord[] = [];
	private options: ExecutionTrackerOptions;

	constructor(options: ExecutionTrackerOptions = {}) {
		this.options = options;
	}

	/**
	 * Start tracking a new agent execution
	 */
	startAgentExecution(
		agentName: string,
		agentType: "llm" | "sequential" | "loop" = "llm",
	): void {
		// Finalize any previous execution
		if (this.currentAgentExecution) {
			this.finalizeAgentExecution("completed");
		}

		this.currentAgentExecution = {
			agentName,
			agentType,
			status: "running",
			startedAt: new Date().toISOString(),
			toolExecutions: [],
		};
		this.currentToolExecutions = [];

		this.options.onAgentStart?.(agentName);
	}

	/**
	 * Record a tool execution within the current agent
	 */
	recordToolExecution(
		execution: Omit<ToolExecutionRecord, "executedAt">,
	): void {
		const fullExecution: ToolExecutionRecord = {
			...execution,
			executedAt: new Date().toISOString(),
		};

		this.currentToolExecutions.push(fullExecution);
		this.options.onToolEnd?.(fullExecution);
	}

	/**
	 * Finalize the current agent execution
	 */
	finalizeAgentExecution(
		status: "completed" | "failed",
		output?: unknown,
		error?: string,
		confidence?: number,
	): void {
		if (!this.currentAgentExecution) {
			return;
		}

		const completedAt = new Date().toISOString();
		const startedAt = this.currentAgentExecution.startedAt
			? new Date(this.currentAgentExecution.startedAt)
			: new Date();
		const executionTimeMs =
			new Date(completedAt).getTime() - startedAt.getTime();

		const finalExecution: AgentExecutionRecord = {
			...this.currentAgentExecution,
			status,
			completedAt,
			executionTimeMs,
			output,
			error,
			confidence,
			toolExecutions: this.currentToolExecutions,
		};

		this.agentExecutions.push(finalExecution);
		this.options.onAgentEnd?.(finalExecution);

		this.currentAgentExecution = null;
		this.currentToolExecutions = [];
	}

	/**
	 * Get all recorded agent executions
	 */
	getAgentExecutions(): AgentExecutionRecord[] {
		// Include current execution if still running
		if (this.currentAgentExecution) {
			return [
				...this.agentExecutions,
				{
					...this.currentAgentExecution,
					toolExecutions: this.currentToolExecutions,
				},
			];
		}
		return this.agentExecutions;
	}

	/**
	 * Get total execution time across all agents
	 */
	getTotalExecutionTime(): number {
		return this.agentExecutions.reduce(
			(total, ex) => total + (ex.executionTimeMs || 0),
			0,
		);
	}

	/**
	 * Get agent progression map
	 */
	getAgentProgression(): Record<string, boolean> {
		const progression: Record<string, boolean> = {};
		for (const ex of this.agentExecutions) {
			progression[ex.agentName] = ex.status === "completed";
		}
		return progression;
	}

	/**
	 * Clear all recorded executions
	 */
	clear(): void {
		this.agentExecutions = [];
		this.currentAgentExecution = null;
		this.currentToolExecutions = [];
	}
}

/**
 * Tracked tool info stored between start and end events.
 */
interface TrackedToolInfo {
	startTime: number;
	toolName: string;
	input: unknown;
	parentRunId?: string;
	metadata?: Record<string, unknown>;
}

/**
 * LangChain callback handler that records executions to an ExecutionTracker.
 * Attach this to LLM calls to automatically track tool usage.
 *
 * Enhanced to:
 * - Track tool names from handleToolStart to handleToolEnd
 * - Include metadata for LangSmith nested trace visibility
 * - Support parent-child trace relationships
 */
export class ExecutionTrackerCallbackHandler extends BaseCallbackHandler {
	name = "ExecutionTrackerCallbackHandler";
	private tracker: ExecutionTracker;
	private trackedTools: Map<string, TrackedToolInfo> = new Map();

	/**
	 * Optional metadata to include in all traces.
	 * Useful for identifying agent name, role, parent agent, etc.
	 */
	public traceMetadata: Record<string, unknown> = {};

	constructor(tracker: ExecutionTracker, metadata?: Record<string, unknown>) {
		super();
		this.tracker = tracker;
		if (metadata) {
			this.traceMetadata = metadata;
		}
	}

	/**
	 * Set metadata that will be included in trace information.
	 * Useful for setting agent context before execution.
	 */
	setTraceMetadata(metadata: Record<string, unknown>): void {
		this.traceMetadata = { ...this.traceMetadata, ...metadata };
	}

	override async handleToolStart(
		tool: { name?: string },
		input: string,
		runId: string,
		parentRunId?: string,
		_tags?: string[],
		metadata?: Record<string, unknown>,
		_runName?: string,
	): Promise<void> {
		// Store tool info for use in handleToolEnd
		this.trackedTools.set(runId, {
			startTime: Date.now(),
			toolName: tool.name || "unknown",
			input: this.safeParseInput(input),
			parentRunId,
			metadata: { ...this.traceMetadata, ...metadata },
		});
	}

	async handleToolEnd(output: string, runId: string): Promise<void> {
		const trackedInfo = this.trackedTools.get(runId);
		const executionTimeMs = trackedInfo
			? Date.now() - trackedInfo.startTime
			: undefined;

		// Get tool name from tracked info (fixed from "unknown")
		const toolName = trackedInfo?.toolName || "unknown";

		this.tracker.recordToolExecution({
			toolName,
			status: "success",
			result: output,
			executionTimeMs,
		});

		// Clean up tracked info
		this.trackedTools.delete(runId);
	}

	async handleToolError(err: Error, runId: string): Promise<void> {
		const trackedInfo = this.trackedTools.get(runId);
		const executionTimeMs = trackedInfo
			? Date.now() - trackedInfo.startTime
			: undefined;

		// Get tool name from tracked info (fixed from "unknown")
		const toolName = trackedInfo?.toolName || "unknown";

		this.tracker.recordToolExecution({
			toolName,
			status: "error",
			error: err.message,
			executionTimeMs,
		});

		// Clean up tracked info
		this.trackedTools.delete(runId);
	}

	/**
	 * Safely parse tool input, handling both string and object inputs.
	 */
	private safeParseInput(input: string | unknown): unknown {
		if (typeof input === "string") {
			try {
				return JSON.parse(input);
			} catch {
				return input;
			}
		}
		return input;
	}
}

/**
 * Create an execution tracker with optional callbacks
 */
export function createExecutionTracker(
	options?: ExecutionTrackerOptions,
): ExecutionTracker {
	return new ExecutionTracker(options);
}

/**
 * Options for creating an execution tracker callback handler.
 */
export interface ExecutionTrackerCallbackOptions {
	/** The execution tracker to record to */
	tracker: ExecutionTracker;
	/**
	 * Metadata to include in traces.
	 * Useful for identifying agent name, role, parent agent, etc.
	 * This enables proper nested trace visualization in LangSmith.
	 */
	metadata?: {
		agentName?: string;
		agentRole?: string;
		parentAgent?: string;
		[key: string]: unknown;
	};
}

/**
 * Create a LangChain callback handler for an execution tracker.
 *
 * @param trackerOrOptions - Either an ExecutionTracker or options object
 * @returns A callback handler for LangChain
 *
 * @example
 * // Simple usage
 * const callback = createExecutionTrackerCallback(tracker);
 *
 * @example
 * // With metadata for LangSmith visibility
 * const callback = createExecutionTrackerCallback({
 *   tracker,
 *   metadata: {
 *     agentName: "gatherer",
 *     agentRole: "context_gathering",
 *     parentAgent: "commander"
 *   }
 * });
 */
export function createExecutionTrackerCallback(
	trackerOrOptions: ExecutionTracker | ExecutionTrackerCallbackOptions,
): ExecutionTrackerCallbackHandler {
	if ("tracker" in trackerOrOptions) {
		return new ExecutionTrackerCallbackHandler(
			trackerOrOptions.tracker,
			trackerOrOptions.metadata,
		);
	}
	return new ExecutionTrackerCallbackHandler(trackerOrOptions);
}
