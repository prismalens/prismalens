import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type {
	AgentExecutionRecord,
	ToolExecutionRecord,
} from "../types/state.js";

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
 * LangChain callback handler that records executions to an ExecutionTracker.
 * Attach this to LLM calls to automatically track tool usage.
 */
export class ExecutionTrackerCallbackHandler extends BaseCallbackHandler {
	name = "ExecutionTrackerCallbackHandler";
	private tracker: ExecutionTracker;
	private toolStartTimes: Map<string, number> = new Map();

	constructor(tracker: ExecutionTracker) {
		super();
		this.tracker = tracker;
	}

	override async handleToolStart(
		tool: { name?: string },
		input: string,
		runId: string,
		_parentRunId?: string,
		_tags?: string[],
		_metadata?: Record<string, unknown>,
		_runName?: string,
	): Promise<void> {
		this.toolStartTimes.set(runId, Date.now());
	}

	async handleToolEnd(output: string, runId: string): Promise<void> {
		const startTime = this.toolStartTimes.get(runId);
		const executionTimeMs = startTime ? Date.now() - startTime : undefined;
		this.toolStartTimes.delete(runId);

		// Note: Tool name is not available in handleToolEnd
		// This is a limitation - we'd need to track it from handleToolStart
		this.tracker.recordToolExecution({
			toolName: "unknown", // Would need to be tracked from start
			status: "success",
			result: output,
			executionTimeMs,
		});
	}

	async handleToolError(err: Error, runId: string): Promise<void> {
		const startTime = this.toolStartTimes.get(runId);
		const executionTimeMs = startTime ? Date.now() - startTime : undefined;
		this.toolStartTimes.delete(runId);

		this.tracker.recordToolExecution({
			toolName: "unknown",
			status: "error",
			error: err.message,
			executionTimeMs,
		});
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
 * Create a LangChain callback handler for an execution tracker
 */
export function createExecutionTrackerCallback(
	tracker: ExecutionTracker,
): ExecutionTrackerCallbackHandler {
	return new ExecutionTrackerCallbackHandler(tracker);
}
