// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Type } from "class-transformer";
import {
	IsArray,
	IsBoolean,
	IsObject,
	IsOptional,
	IsString,
	IsUUID,
	ValidateNested,
} from "class-validator";

export class CreateRepositoryDto {
	@IsUUID()
	connectionId!: string;

	@IsString()
	fullName!: string;

	@IsString()
	url!: string;

	@IsOptional()
	@IsString()
	description?: string;

	@IsOptional()
	@IsString()
	language?: string;

	@IsOptional()
	@IsString()
	defaultBranch?: string;

	@IsOptional()
	@IsBoolean()
	isPrivate?: boolean;

	@IsOptional()
	@IsObject()
	metadata?: Record<string, unknown>;
}

export class BatchCreateRepositoriesDto {
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CreateRepositoryDto)
	repositories!: CreateRepositoryDto[];
}
