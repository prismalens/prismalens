// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	IsBoolean,
	IsEnum,
	IsNotEmpty,
	IsOptional,
	IsString,
} from "class-validator";
import {
	EffortEstimate,
	RecommendationCategory,
	RecommendationPriority,
	Urgency,
} from "../../../shared/enums/index.js";

/**
 * DTO for recommendation data from worker
 */
export class RecommendationDto {
	@IsString()
	@IsNotEmpty()
	title!: string;

	@IsOptional()
	@IsString()
	description?: string;

	@IsOptional()
	@IsEnum(RecommendationPriority)
	priority?: RecommendationPriority;

	@IsOptional()
	@IsEnum(RecommendationCategory)
	category?: RecommendationCategory;

	@IsOptional()
	@IsEnum(Urgency)
	urgency?: Urgency;

	@IsOptional()
	@IsBoolean()
	actionable?: boolean;

	@IsOptional()
	@IsEnum(EffortEstimate)
	estimatedEffort?: EffortEstimate;
}
