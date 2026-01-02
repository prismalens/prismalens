import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsArray,
  IsDateString,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ToolExecutionDto } from './tool-execution.dto.js';
import { AgentType, ExecutionStatus } from '../../../shared/enums/index.js';

/**
 * DTO for agent execution data from worker
 */
export class AgentExecutionDto {
  @IsString()
  agentName!: string;

  @IsOptional()
  @IsEnum(AgentType)
  agentType?: AgentType;

  @IsOptional()
  @IsEnum(ExecutionStatus)
  status?: ExecutionStatus;

  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  executionTimeMs?: number;

  @IsOptional()
  @IsObject()
  output?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  inputTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  outputTokens?: number;

  @IsOptional()
  @IsString()
  error?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ToolExecutionDto)
  toolExecutions?: ToolExecutionDto[];
}
