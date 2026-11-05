// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadSubjectKind } from "@prismalens/contracts";
import type { HarnessTool } from "@prismalens/integrations/harness";

/** Tools that read or record an incident's investigation or its threads; a thread with no incident has none. */
export const INCIDENT_TOOLS: ReadonlySet<string> = new Set([
	"incident_get",
	"timeline_read",
	"changes_list",
	"evidence_record",
	"hypothesis_record",
	"report_validate",
	"thread_list",
	"thread_read",
]);

/** A no-subject thread's whole catalogue: no incident, service or code to read about. */
export const NO_SUBJECT_TOOLS: ReadonlySet<string> = new Set([
	"thread_title",
	"artifact_publish",
]);

/**
 * The tools a run's subject may see (#1020). Incident and schedule runs, and a run
 * with no known subject, keep every tool; replay reads recorded events, not this list.
 */
export function subjectTools(
	tools: readonly HarnessTool[],
	subject?: ThreadSubjectKind,
): readonly HarnessTool[] {
	if (subject === "none")
		return tools.filter((t) => NO_SUBJECT_TOOLS.has(t.name));
	if (subject === "project" || subject === "service")
		return tools.filter((t) => !INCIDENT_TOOLS.has(t.name));
	return tools;
}
