/**
 * DTO for updating an alert mapping rule.
 */
export class UpdateMappingRuleDto {
	name?: string;
	description?: string;
	priority?: number;
	enabled?: boolean;
	matchCriteria?: string | Record<string, unknown>;
	serviceId?: string;
}
