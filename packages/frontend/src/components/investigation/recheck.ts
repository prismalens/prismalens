// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel } from "@prismalens/config/harness";
import {
	fidelityAccess,
	type InvestigationWithRelations,
	isRunStateLive,
} from "@prismalens/contracts";
import {
	defaultAccessOf,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import { useIncidentRecord } from "@/components/incidents/record-context";
import { runNumber } from "@/components/incidents/run-facts";
import { startedBy } from "@/components/run/run-labels";
import { recheckBrief } from "@/lib/run-verb";

/**
 * The level a run's follow-up or recheck goes at: the run's own, or the
 * person's Settings for an ended alert-started run (#673 w6-13).
 */
export function runFollowUpLevel(
	inv: InvestigationWithRelations | null | undefined,
	settings: AccessLevel,
	live: boolean,
): AccessLevel {
	if (!live && startedBy(inv?.triggerType) === "PrismaLens") return settings;
	return (
		inv?.accessLevel ??
		(inv?.report?.fidelity
			? fidelityAccess(inv.report.fidelity, inv.agentMode)
			: undefined) ??
		"supervised"
	);
}

/** Investigate again from a reported run: a new run with its report quoted; null when there is none. */
export function useRecheck():
	| ((text?: string, attachments?: string[]) => Promise<void>)
	| null {
	const record = useIncidentRecord();
	const choice = useAgentChoice();
	const inv = record.run.investigation;
	const live = !!record.run.state && isRunStateLive(record.run.state);
	const harness = choice.harnesses.find((h) => h.id === inv?.harness);
	const report = inv?.report;
	// startOrGet hands back the live run and drops the recheck text, so offer none while any run is live.
	if (
		!inv ||
		!report ||
		live ||
		record.liveRun ||
		choice.isLoading ||
		inv.kind === "chat"
	)
		return null;
	const level = runFollowUpLevel(
		inv,
		defaultAccessOf(harness, choice.axes).level.level,
		live,
	);
	return (text = "", attachments = []) =>
		record.investigate({
			text: recheckBrief(report, runNumber(record.runs, inv.id), text),
			accessLevel: level,
			attachments,
		});
}
