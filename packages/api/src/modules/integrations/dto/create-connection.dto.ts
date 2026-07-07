// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	IsBoolean,
	IsNotEmpty,
	IsNumber,
	IsObject,
	IsOptional,
	IsString,
	IsUrl,
	IsUUID,
} from "class-validator";

export class CreateIntegrationDto {
	@IsString()
	@IsNotEmpty()
	templateId!: string;

	@IsString()
	label!: string;

	@IsOptional()
	@IsString()
	clientId?: string;

	@IsOptional()
	@IsString()
	clientSecret?: string;

	@IsOptional()
	@IsString({ each: true })
	scopes?: string[];

	@IsOptional()
	@IsUrl()
	callbackUrl?: string;
}

export class CreateConnectionDto {
	@IsUUID()
	integrationId!: string;

	@IsString()
	@IsNotEmpty()
	label!: string;

	@IsObject()
	credentials!: Record<string, string>;

	@IsOptional()
	@IsObject()
	connectionConfig?: Record<string, string>;
}

export class CreateServiceIntegrationDto {
	@IsUUID()
	serviceId!: string;

	@IsUUID()
	connectionId!: string;

	@IsOptional()
	@IsObject()
	config?: Record<string, unknown>;

	@IsOptional()
	@IsNumber()
	priority?: number;

	@IsOptional()
	@IsBoolean()
	isEnabled?: boolean;
}
