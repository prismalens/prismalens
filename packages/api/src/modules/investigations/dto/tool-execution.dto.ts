import type {
	ToolCategory,
	ToolExecutionStatus,
} from "../../../shared/enums/index.js";

/**
 * DTO for creating a tool execution record
 */
export class CreateToolExecutionDto {
	agentExecutionId!: string;
	toolName!: string;
	toolCategory?: ToolCategory;
	arguments?: Record<string, unknown>;
	result?: Record<string, unknown>;
	status?: ToolExecutionStatus;
	executionTimeMs?: number;
	error?: string;
}
