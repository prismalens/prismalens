/**
 * DTO for creating an alert mapping rule.
 * Maps incoming alerts to services based on match criteria.
 */
export class CreateMappingRuleDto {
	name: string;
	description?: string;
	priority?: number; // Lower = higher priority (default 100)
	enabled?: boolean; // Default true

	// Match criteria as JSON string or object
	// Example: { "labels": {"app": "api-*"}, "source": "prometheus" }
	matchCriteria: string | Record<string, unknown>;

	// Target service ID
	serviceId: string;
}
