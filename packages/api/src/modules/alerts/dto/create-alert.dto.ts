import {
	IsArray,
	IsEnum,
	IsNotEmpty,
	IsObject,
	IsOptional,
	IsString,
} from "class-validator";
import { Severity } from "../../../shared/enums/index.js";

/**
 * DTO for creating an alert
 */
export class CreateAlertDto {
	/** Alert title */
	@IsString()
	@IsNotEmpty()
	title!: string;

	/** Alert description */
	@IsOptional()
	@IsString()
	description?: string;

	/** Severity: critical, high, medium, low, info */
	@IsOptional()
	@IsEnum(Severity)
	severity?: Severity;

	/** Source system: prometheus, github, render, datadog, etc. */
	@IsOptional()
	@IsString()
	source?: string;

	/** Alert ID from source system */
	@IsOptional()
	@IsString()
	sourceAlertId?: string;

	/** URL to view alert in source system */
	@IsOptional()
	@IsString()
	sourceUrl?: string;

	/** Service ID (from service catalog) */
	@IsOptional()
	@IsString()
	serviceId?: string;

	/** Tags for categorization */
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	tags?: string[];

	/** Key-value labels for alert matching */
	@IsOptional()
	@IsObject()
	labels?: Record<string, string>;

	/** Full raw payload from source */
	@IsOptional()
	@IsObject()
	rawPayload?: Record<string, unknown>;
}
