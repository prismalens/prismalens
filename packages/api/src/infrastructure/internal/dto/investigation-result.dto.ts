import { Type } from "class-transformer";
import {
	IsArray,
	IsEnum,
	IsNotEmpty,
	IsNumber,
	IsObject,
	IsOptional,
	IsString,
	Max,
	Min,
	ValidateNested,
} from "class-validator";
import {
	RootCauseCategory,
	WorkflowStatus,
} from "../../../shared/enums/index.js";
import { AgentExecutionDto } from "./agent-execution.dto.js";
import { RecommendationDto } from "./recommendation.dto.js";

/**
 * Subset of WorkflowStatus for result status (only completed or failed)
 */
type ResultStatus = Extract<WorkflowStatus, "completed" | "failed">;

const ResultStatusEnum = {
	completed: WorkflowStatus.completed,
	failed: WorkflowStatus.failed,
} as const;

/**
 * DTO for full investigation result (sent by worker when complete)
 * This is used by the internal API to write all results atomically
 */
export class InternalInvestigationResultDto {
	@IsEnum(ResultStatusEnum)
	status!: ResultStatus;

	@IsString()
	@IsNotEmpty()
	incidentId!: string;

	/** Executive summary of findings */
	@IsOptional()
	@IsString()
	summary?: string;

	/** Identified root cause */
	@IsOptional()
	@IsString()
	rootCause?: string;

	/** Root cause category */
	@IsOptional()
	@IsEnum(RootCauseCategory)
	rootCauseCategory?: RootCauseCategory;

	/** Confidence score (0.0 to 1.0) */
	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(1)
	confidence?: number;

	/** Data quality scores per source */
	@IsOptional()
	@IsObject()
	dataQuality?: Record<string, number>;

	/** Data sources used in analysis */
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	dataSourcesUsed?: string[];

	/** Raw output from agents */
	@IsOptional()
	@IsObject()
	rawOutput?: Record<string, unknown>;

	/** Error message if failed */
	@IsOptional()
	@IsString()
	error?: string;

	/** Agent executions with nested tool executions */
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => AgentExecutionDto)
	agentExecutions?: AgentExecutionDto[];

	/** Recommendations generated */
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => RecommendationDto)
	recommendations?: RecommendationDto[];

	/** Timeline entry for completion (optional - can be created separately) */
	@IsOptional()
	@IsObject()
	timelineEntry?: {
		title: string;
		description?: string;
		metadata?: Record<string, unknown>;
	};
}
