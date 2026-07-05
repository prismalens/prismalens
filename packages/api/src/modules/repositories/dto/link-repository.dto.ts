// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { IsBoolean, IsOptional, IsString, IsUUID } from "class-validator";

export class LinkRepositoryDto {
	@IsUUID()
	serviceId!: string;

	@IsOptional()
	@IsString()
	subPath?: string;

	@IsOptional()
	@IsBoolean()
	isPrimary?: boolean;
}
