import {
	IsEnum,
	IsInt,
	IsNumber,
	IsObject,
	IsOptional,
	IsString,
	Max,
	Min,
} from "class-validator";
import {
	ToolCategory,
	ToolExecutionStatus,
} from "../../../shared/enums/index.js";

/**
 * DTO for tool execution data from worker
 */
export class ToolExecutionDto {
	@IsString()
	toolName!: string;

	@IsOptional()
	@IsEnum(ToolCategory)
	toolCategory?: ToolCategory;

	@IsOptional()
	@IsObject()
	arguments?: Record<string, unknown>;

	@IsOptional()
	@IsObject()
	result?: Record<string, unknown>;

	@IsOptional()
	@IsEnum(ToolExecutionStatus)
	status?: ToolExecutionStatus;

	@IsOptional()
	@IsInt()
	@Min(0)
	executionTimeMs?: number;

	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(1)
	confidence?: number;

	@IsOptional()
	@IsString()
	dataQuality?: string;

	@IsOptional()
	@IsString()
	error?: string;
}
