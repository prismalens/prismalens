/**
 * DTO for creating an agent execution record
 */
export class CreateAgentExecutionDto {
	investigationId!: string;
	agentName!: string;
	agentType?: "llm" | "sequential" | "loop";
}

/**
 * DTO for updating an agent execution
 */
export class UpdateAgentExecutionDto {
	status?: "pending" | "running" | "completed" | "failed";
	startedAt?: Date;
	completedAt?: Date;
	executionTimeMs?: number;
	output?: string | Record<string, unknown>;
	confidence?: number;
	inputTokens?: number;
	outputTokens?: number;
	error?: string;
}
