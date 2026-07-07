// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Type } from "class-transformer";
import {
	IsArray,
	IsDateString,
	IsEnum,
	IsInt,
	IsObject,
	IsOptional,
	IsString,
	Min,
	ValidateNested,
} from "class-validator";
import { AgentType, ExecutionStatus } from "../../../shared/enums/index.js";
import { ToolExecutionDto } from "./tool-execution.dto.js";

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
