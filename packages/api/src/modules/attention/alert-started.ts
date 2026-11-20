// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** An alert, a refire or a policy started it; a person's chat or brief is `manual`. */
export function alertStarted(row: {
	triggerType: string | null;
	scheduleId: string | null;
	incidentId: string | null;
}): boolean {
	return !row.scheduleId && !!row.incidentId && row.triggerType !== "manual";
}
