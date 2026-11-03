// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessServes } from "@prismalens/integrations/harness";
import { EVERY_SUBJECT } from "@prismalens/integrations/harness";

/** Every subject with records to read: all but a no-subject thread (#1020). */
export const SCOPED: HarnessServes = {
	subjects: ["incident", "project", "service", "schedule"],
};
export const ANYWHERE: HarnessServes = { subjects: EVERY_SUBJECT };
/** A report's own tools, on whatever it is about. */
export const FOR_A_REPORT: HarnessServes = {
	subjects: EVERY_SUBJECT,
	owes: "report",
};
export const INCIDENT_ONLY: HarnessServes = { subjects: ["incident"] };
