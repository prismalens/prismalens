import { Type } from "class-transformer";
import {
	IsArray,
	IsBoolean,
	IsEnum,
	IsNotEmpty,
	IsNumber,
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

// Nested DTOs for GitHub webhook structure
class GithubIssueDto {
	@IsNumber()
	number!: number;

	@IsString()
	title!: string;

	@IsOptional()
	@IsString()
	body?: string;

	@IsOptional()
	@IsString()
	html_url?: string;

	@IsOptional()
	@IsArray()
	labels?: Array<{ name: string }>;

	@IsOptional()
	@IsString()
	state?: string;
}

class GithubPullRequestDto {
	@IsNumber()
	number!: number;

	@IsString()
	title!: string;

	@IsOptional()
	@IsString()
	body?: string;

	@IsOptional()
	@IsString()
	html_url?: string;

	@IsOptional()
	@IsString()
	state?: string;

	@IsOptional()
	@IsBoolean()
	merged?: boolean;
}

class GithubAlertDto {
	@IsNumber()
	number!: number;

	@IsOptional()
	@IsString()
	html_url?: string;

	@IsOptional()
	@IsString()
	state?: string;

	@IsOptional()
	@IsString()
	severity?: string;

	@IsOptional()
	@IsString()
	summary?: string;
}

class GithubRepositoryDto {
	@IsString()
	full_name!: string;

	@IsOptional()
	@IsString()
	html_url?: string;
}

class GithubSenderDto {
	@IsString()
	login!: string;
}

export class GithubWebhookDto {
	@IsOptional()
	@IsString()
	action?: string;

	@IsOptional()
	@ValidateNested()
	@Type(() => GithubIssueDto)
	issue?: GithubIssueDto;

	@IsOptional()
	@ValidateNested()
	@Type(() => GithubPullRequestDto)
	pull_request?: GithubPullRequestDto;

	@IsOptional()
	@ValidateNested()
	@Type(() => GithubAlertDto)
	alert?: GithubAlertDto;

	@IsOptional()
	@ValidateNested()
	@Type(() => GithubRepositoryDto)
	repository?: GithubRepositoryDto;

	@IsOptional()
	@ValidateNested()
	@Type(() => GithubSenderDto)
	sender?: GithubSenderDto;
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
