// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	IsEnum,
	IsNotEmpty,
	IsObject,
	IsOptional,
	IsString,
	IsUUID,
} from "class-validator";
import {
	TimelineEntryType,
	TimelineSource,
} from "../../../shared/enums/index.js";

/**
 * DTO for creating a timeline entry via internal API
 */
export class CreateTimelineEntryDto {
	@IsUUID()
	incidentId!: string;

	@IsEnum(TimelineEntryType)
	type!: TimelineEntryType;

	@IsString()
	@IsNotEmpty()
	title!: string;

	@IsOptional()
	@IsString()
	description?: string;

	@IsOptional()
	@IsObject()
	metadata?: Record<string, unknown>;

	@IsOptional()
	@IsEnum(TimelineSource)
	source?: TimelineSource;
}
