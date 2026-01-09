import { Type } from "class-transformer";
import {
	IsBoolean,
	IsEnum,
	IsObject,
	IsOptional,
	IsString,
	ValidateNested,
} from "class-validator";
import { AuthMethod } from "../../../shared/enums/index.js";

/**
 * Credentials for API key authentication.
 */
export class ApiKeyCredentialsDto {
	@IsString()
	apiKey!: string;

	@IsOptional()
	@IsString()
	username?: string;

	@IsOptional()
	@IsString()
	password?: string;
}

/**
 * Credentials for OAuth authentication (after token exchange).
 */
export class OAuthCredentialsDto {
	@IsString()
	accessToken!: string;

	@IsOptional()
	@IsString()
	refreshToken?: string;

	@IsOptional()
	@IsString()
	expiresAt?: string; // ISO date string

	@IsOptional()
	@IsString()
	tokenType?: string;

	@IsOptional()
	@IsString()
	scope?: string;
}

/**
 * DTO for creating a new integration connection.
 */
export class CreateConnectionDto {
	@IsString()
	definitionId!: string;

	@IsString()
	name!: string;

	@IsOptional()
	@IsString()
	description?: string;

	@IsOptional()
	@IsBoolean()
	isGlobal?: boolean;

	@IsEnum(AuthMethod)
	authMethod!: AuthMethod;

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
