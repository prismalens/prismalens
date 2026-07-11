// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Emitted by CorrelationService once an alert has been linked to an incident. */
export const ALERT_CORRELATED_EVENT = "alert.correlated";

export interface AlertCorrelatedEvent {
	/** The alert that was just correlated. */
	alertId: string;
	/** The incident it was linked to (existing or newly created). */
	incidentId: string;
	/** True when correlation created a brand-new incident for this alert. */
	isNewIncident: boolean;
}
