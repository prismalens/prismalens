/**
 * DTO for creating a raw event
 * Events are immutable records of incoming signals from monitoring systems
 */
export class CreateEventDto {
	/** Source system: prometheus, github, render, generic */
	source!: string;

	/** Optional ID from source system for deduplication */
	sourceEventId?: string;

	/** Event type: alert, deployment, commit */
	eventType!: string;

	/** Full raw payload (will be JSON stringified if object) */
	payload!: string | Record<string, unknown>;

	/** When the event actually occurred (if different from received time) */
	eventTime?: string;
}
