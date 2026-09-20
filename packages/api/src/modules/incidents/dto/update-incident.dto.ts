// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	IncidentStatus,
	Priority,
	Severity,
} from "../../../shared/enums/index.js";

/**
 * DTO for updating an incident
 */
export class UpdateIncidentDto {
	title?: string;
	description?: string;
	severity?: Severity;
	status?: IncidentStatus;
	priority?: Priority;
	serviceId?: string;
	correlationReason?: string;
	tags?: string[];
	customerImpact?: string;
	assignedToId?: string;
	/** What actually caused it, recorded on close (#338). */
	actualCause?: string;
	actualCauseCategory?: string;
}
