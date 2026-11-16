// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { InvestigationTriggerType } from "@prismalens/contracts";
import { defineClosed } from "@prismalens/registry";

interface TriggerTypeView {
	/** A person started it; every other type is PrismaLens starting it on its own. */
	byUser: boolean;
	/** Why PrismaLens started it, under the started line; absent, nothing to add. */
	why?: string;
}

const TRIGGER_TYPES: Record<InvestigationTriggerType, TriggerTypeView> = {
	manual: { byUser: true },
	auto_critical: {
		byUser: false,
		why: "A critical alert fired; runs start on their own for those",
	},
	auto_tier: {
		byUser: false,
		why: "The service's tier starts a run on its own when an alert fires",
	},
	alert_threshold: { byUser: false },
	scheduled: { byUser: false },
	re_trigger: {
		byUser: false,
		why: "The alert fired again after the incident ended",
	},
};

/** How a run was started (#811): who started it and why, by its stored trigger type. */
export const triggerTypes = defineClosed(
	"triggerType",
	Object.keys(TRIGGER_TYPES) as InvestigationTriggerType[],
	TRIGGER_TYPES,
);

/** A run with no trigger type was started by hand; an unknown type is PrismaLens's own. */
export function startedByUser(triggerType: string | null | undefined): boolean {
	if (!triggerType) return true;
	return (
		TRIGGER_TYPES[triggerType as InvestigationTriggerType]?.byUser ?? false
	);
}

export function triggerWhy(
	triggerType: string | null | undefined,
): string | null {
	return (
		TRIGGER_TYPES[(triggerType ?? "") as InvestigationTriggerType]?.why ?? null
	);
}
