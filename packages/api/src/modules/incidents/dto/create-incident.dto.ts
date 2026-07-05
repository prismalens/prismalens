// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Priority, Severity } from "../../../shared/enums/index.js";

/**
 * DTO for creating an incident
 */
export class CreateIncidentDto {
	/** Incident title */
	title!: string;

	/** Detailed description */
	description?: string;

	/** Severity level */
	severity?: Severity;

	/** Priority level */
	priority?: Priority;

	/** Primary affected service ID */
	serviceId?: string;

	/** Why alerts were grouped together */
	correlationReason?: string;

	/** Tags for categorization */
	tags?: string[];

	/** Description of customer impact */
	customerImpact?: string;
}
