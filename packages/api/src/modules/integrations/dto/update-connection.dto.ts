import { Type } from "class-transformer";
import {
	IsArray,
	IsBoolean,
	IsEnum,
	IsInt,
	IsObject,
	IsOptional,
	IsString,
	Min,
	ValidateNested,
} from "class-validator";
import { ConnectionStatus } from "../../../shared/enums/index.js";
import {
	ApiKeyCredentialsDto,
	OAuthCredentialsDto,
} from "./create-connection.dto.js";

/**
 * DTO for updating an integration connection.
 */
export class UpdateConnectionDto {
	@IsOptional()
	@IsString()
	name?: string;

	@IsOptional()
	@IsString()
	description?: string;

	@IsOptional()
	@IsBoolean()
	isGlobal?: boolean;

	@IsOptional()
	@IsEnum(ConnectionStatus)
	status?: ConnectionStatus;

	@IsOptional()
	@ValidateNested()
	@Type(() => ApiKeyCredentialsDto)
	apiKeyCredentials?: ApiKeyCredentialsDto;

	@IsOptional()
	@ValidateNested()
	@Type(() => OAuthCredentialsDto)
	oauthCredentials?: OAuthCredentialsDto;

	@IsOptional()
	@IsObject()
	config?: Record<string, unknown>;
}

/**
 * DTO for updating OAuth app configuration on an integration definition (admin only).
 */
export class UpdateOAuthConfigDto {
	@IsString()
	clientId!: string;

	@IsString()
	clientSecret!: string;

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	scopes?: string[];

	@IsOptional()
	@IsString()
	authUrl?: string;

	@IsOptional()
	@IsString()
	tokenUrl?: string;
}

/**
 * DTO for creating a service integration mapping.
 */
export class CreateServiceIntegrationDto {
	@IsString()
	connectionId!: string;

	@IsOptional()
	@IsObject()
	config?: Record<string, unknown>;

	@IsOptional()
	@IsInt()
	@Min(0)
	priority?: number;
}
