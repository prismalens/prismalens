import { AgentType, ExecutionStatus } from "../../../shared/enums/index.js";

/**
 * DTO for creating an agent execution record
 */
export class CreateAgentExecutionDto {
	investigationId!: string;
	agentName!: string;
	agentType?: AgentType;
}

/**
 * DTO for updating an agent execution
 */
export class UpdateAgentExecutionDto {
	status?: ExecutionStatus;
	startedAt?: Date;
	completedAt?: Date;
	executionTimeMs?: number;
	output?: string | Record<string, unknown>;
	confidence?: number;
	inputTokens?: number;
	outputTokens?: number;
	error?: string;
}
