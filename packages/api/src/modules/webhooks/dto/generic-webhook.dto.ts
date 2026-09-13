// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Type } from "class-transformer";
import {
	IsArray,
	IsEnum,
	IsNotEmpty,
	IsObject,
	IsOptional,
	IsString,
	ValidateNested,
} from "class-validator";
import { Severity } from "../../../shared/enums/index.js";

/**
 * DTO for generic webhook ingestion
 */
export class GenericWebhookDto {
	/** Alert title */
	@IsString()
	@IsNotEmpty()
	title!: string;

	/** Alert description */
	@IsOptional()
	@IsString()
	description?: string;

	/** Severity level */
	@IsOptional()
	@IsEnum(Severity)
	severity?: Severity;

	/** Source system identifier */
	@IsOptional()
	@IsString()
	source?: string;

	/** URL to view alert in source system */
	@IsOptional()
	@IsString()
	sourceUrl?: string;

	/** Event ID from source for deduplication */
	@IsOptional()
	@IsString()
	sourceEventId?: string;

	/** When the event occurred */
	@IsOptional()
	@IsString()
	eventTime?: string;

	/** Tags for categorization */
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	tags?: string[];

	/** Key-value labels for alert matching */
	@IsOptional()
	@IsObject()
	labels?: Record<string, string>;

	/** Full raw payload */
	@IsOptional()
	@IsObject()
	rawPayload?: Record<string, unknown>;
}

// Nested DTOs for Render webhook structure
class RenderServiceDto {
	@IsString()
	id!: string;

	@IsString()
	name!: string;

	@IsOptional()
	@IsString()
	type?: string;
}

class RenderDeployDto {
	@IsString()
	id!: string;

	@IsString()
	status!: string;

	@IsOptional()
	@IsString()
	finishedAt?: string;
}

class RenderHealthCheckDto {
	@IsOptional()
	@IsString()
	path?: string;

	@IsOptional()
	@IsString()
	protocol?: string;
}

export class RenderWebhookDto {
	@IsOptional()
	@IsString()
	type?: string;

	@IsOptional()
	@ValidateNested()
	@Type(() => RenderServiceDto)
	service?: RenderServiceDto;

	@IsOptional()
	@ValidateNested()
	@Type(() => RenderDeployDto)
	deploy?: RenderDeployDto;

	@IsOptional()
	@ValidateNested()
	@Type(() => RenderHealthCheckDto)
	healthCheck?: RenderHealthCheckDto;

	@IsOptional()
	@IsString()
	timestamp?: string;
}
