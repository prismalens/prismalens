// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Zod-free, so the shell reads these without loading a schema (#1130).
import type { AccessLevel } from "@prismalens/config/harness";
import type { RunFidelity } from "./investigation.js";
import { LEGACY_ACCESS_LEVEL } from "./state-labels.js";

/** Characters of one artifact's HTML (#871). */
export const ARTIFACT_HTML_CHARS = 200_000;

/**
 * The level a run ran at: the recorded one, else the asked one, else a #778
 * level id (a row with no `agentMode` predates #808, whose ids are agent modes).
 */
export function fidelityAccess(
	f: Pick<RunFidelity, "mode" | "access" | "ranAccess">,
	agentMode: string | null | undefined,
): AccessLevel | undefined {
	return (
		f.ranAccess ??
		f.access ??
		(agentMode == null ? LEGACY_ACCESS_LEVEL[f.mode] : undefined)
	);
}

/** The run's MCP server name: fixed and reserved, so a server of the user's own by it is reported (#1101). */
export const PL_SERVER_NAME = "prismalens";

/** Names the gateway served before every tool took `pl_` (#1101); old records still map to a label. */
export const PL_LEGACY_TOOL_NAMES: readonly string[] = [
	"artifact_publish",
	"ask_user",
	"pr_link",
	"pr_unwatch",
	"pr_watch",
	"attachment_read",
	"attachments_list",
	"changes_list",
	"evidence_record",
	"fixes_list",
	"hypothesis_record",
	"incident_get",
	"incidents_similar",
	"propose_action",
	"investigations_search",
	"report_validate",
	"run_status",
	"runbooks_list",
	"runbooks_read",
	"secret_request",
	"wakeup_schedule",
	"service_get",
	"thread_list",
	"thread_cancel",
	"thread_read",
	"thread_roster",
	"thread_send",
	"thread_start",
	"thread_title",
	"thread_wait",
	"timeline_read",
	"tools_call",
	"tools_search",
];

const LEGACY = new Set(PL_LEGACY_TOOL_NAMES);

/** A PrismaLens tool's current name, for a call or record made under its old bare name. */
export function plToolName(name: string): string {
	return LEGACY.has(name) ? `pl_${name}` : name;
}

/** Our gateway's server, as named now or by an older run (`prismalens-<random>`, #848). */
export function isPlServerName(server: string | undefined): boolean {
	return (
		!!server &&
		(server === PL_SERVER_NAME || /^prismalens-[a-z2-7]{10}$/.test(server))
	);
}
