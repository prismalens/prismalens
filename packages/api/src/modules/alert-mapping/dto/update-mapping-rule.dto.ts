// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

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
