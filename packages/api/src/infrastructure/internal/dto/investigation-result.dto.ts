import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
  IsObject,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AgentExecutionDto } from './agent-execution.dto.js';
import { RecommendationDto } from './recommendation.dto.js';
import { WorkflowStatus, RootCauseCategory } from '../../../shared/enums/index.js';

/**
 * Subset of WorkflowStatus for result status (only completed or failed)
 */
type ResultStatus = WorkflowStatus.COMPLETED | WorkflowStatus.FAILED;

/**
 * DTO for full investigation result (sent by worker when complete)
 * This is used by the internal API to write all results atomically
 */
export class InternalInvestigationResultDto {
  @IsEnum(WorkflowStatus)
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

  /** Which agents completed */
  @IsOptional()
  @IsObject()
  agentProgression?: Record<string, boolean>;

  /** Data sources used in analysis */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dataSourcesUsed?: string[];

  /** Analysis method description */
  @IsOptional()
  @IsString()
  analysisMethod?: string;

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
