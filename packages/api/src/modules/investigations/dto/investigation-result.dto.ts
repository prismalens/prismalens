// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type InvestigationReport,
	TURN_OUTCOMES,
	type TurnOutcome,
} from "@prismalens/contracts";
import { Type } from "class-transformer";
import {
	IsArray,
	IsEnum,
	IsIn,
	IsNotEmpty,
	IsObject,
	IsOptional,
	IsString,
	ValidateNested,
} from "class-validator";
import {
	RootCauseCategory,
	WorkflowStatus,
} from "../../../shared/enums/index.js";
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
 * DTO for full investigation result (written when a run completes). Also the
 * shape passed in-process through {@link RunPorts.writeResult} — 0005 §2.
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

	/** The full ordered-evidence report (ADR-0002), persisted as Investigation.report */
	@IsOptional()
	@IsObject()
	report?: InvestigationReport;

	/** Error message if failed */
	@IsOptional()
	@IsString()
	error?: string;

	/** A follow-up `continue` that reported: its message was answered (#673 w59). */
	@IsOptional()
	@IsIn(TURN_OUTCOMES)
	lastTurnOutcome?: TurnOutcome;

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
