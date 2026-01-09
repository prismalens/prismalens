import {
	IsDateString,
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
 * DTO for creating a timeline entry
 */
export class CreateTimelineEntryDto {
	/** Incident ID */
	@IsUUID()
	incidentId!: string;

	/**
	 * Entry type:
	 * - incident_created, alert_added, alert_removed
	 * - status_changed, severity_changed
	 * - assigned, investigation_started, investigation_completed
	 * - recommendation_added, recommendation_completed
	 * - comment, postmortem_created, custom
	 */
	@IsEnum(TimelineEntryType)
	type!: TimelineEntryType;

	/** Entry title */
	@IsString()
	@IsNotEmpty()
	title!: string;

	/** Optional description */
	@IsOptional()
	@IsString()
	description?: string;

	/** Additional metadata (JSON) */
	@IsOptional()
	@IsObject()
	metadata?: Record<string, unknown>;

	/** Source: system, user, ai_worker */
	@IsOptional()
	@IsEnum(TimelineSource)
	source?: TimelineSource;

	/** User ID if source is 'user' */
	@IsOptional()
	@IsUUID()
	userId?: string;

	/** When the event occurred (defaults to now) */
	@IsOptional()
	@IsDateString()
	occurredAt?: string;
}
