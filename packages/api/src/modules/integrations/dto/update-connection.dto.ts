import {
	IsBoolean,
	IsIn,
	IsObject,
	IsOptional,
	IsString,
} from "class-validator";

export class UpdateIntegrationDto {
	@IsOptional()
	@IsString()
	label?: string;

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
	@IsString()
	callbackUrl?: string;

	@IsOptional()
	@IsBoolean()
	enabled?: boolean;
}

export class UpdateConnectionDto {
	@IsOptional()
	@IsObject()
	credentials?: Record<string, string>;

	@IsOptional()
	@IsObject()
	connectionConfig?: Record<string, string>;

	@IsOptional()
	@IsIn([
		"ACTIVE",
		"DISABLED",
		"TOKEN_EXPIRED",
		"REFRESH_FAILED",
		"CREDENTIALS_INVALID",
		"REVOKED",
		"ERROR",
	])
	status?: string;
}

// Reserved for future use
export class UpdateServiceIntegrationDto {
	@IsOptional()
	@IsObject()
	config?: Record<string, unknown>;

	@IsOptional()
	priority?: number;

	@IsOptional()
	@IsBoolean()
	isEnabled?: boolean;
}
