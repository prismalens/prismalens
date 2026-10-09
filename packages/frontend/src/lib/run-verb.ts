// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { FollowUpKind, InvestigationReport } from "@prismalens/contracts";

/**
 * What a message asks for (#673 w59, DESIGN §4): `Investigate` owes a report,
 * `Ask` owes an answer. The chip exists only where both act on the thread.
 */
export type RunVerb = "investigate" | "ask";

export interface VerbThread {
	/** The draft of a run not sent yet. */
	draft: boolean;
	live?: boolean;
	/** A reportless stopped or failed investigation whose session reopens. */
	continuable?: boolean;
}

/** The verbs the chip offers; empty where the box has one verb and no chip. */
export function verbsFor(thread: VerbThread): RunVerb[] {
	if (thread.live) return [];
	return thread.draft || thread.continuable ? ["investigate", "ask"] : [];
}

/** A draft investigates when there are alerts and no report yet; a stopped run continues. */
export function defaultVerb(
	thread: VerbThread,
	incident: { alertCount: number; reported: boolean },
): RunVerb {
	if (!thread.draft) return "investigate";
	return incident.alertCount > 0 && !incident.reported ? "investigate" : "ask";
}

/** The chip popover's rows: a draft gathers first, a stopped run goes on to its report. */
export function verbCopy(thread: VerbThread): Record<RunVerb, string> {
	return {
		investigate: thread.draft
			? "Gathers the alert, code and telemetry, then starts the agent. Ends with a report."
			: "Continues this run to its report.",
		ask: "A question to the agent. No report.",
	};
}

/** What a follow-up's verb is on the wire. */
export function followUpKind(verb: RunVerb): FollowUpKind {
	return verb === "investigate" ? "continue" : "chat";
}

const RECHECK_CAP = 1500;

/**
 * The draft `Investigate again` opens: whatever was typed, then the report
 * quoted, editable and capped (#673 w59, OBJ-013).
 */
export function recheckBrief(
	report: Pick<InvestigationReport, "summary" | "rootCause" | "nextSteps">,
	runNumber: number,
	typed: string,
): string {
	const steps = report.nextSteps.map((s) => s.title).join("; ");
	const quote = `Re-check Run #${runNumber}. It found: ${report.summary.replace(/\.$/, "")}. Cause named: ${report.rootCause?.replace(/\.$/, "") || "none"}. Next steps it proposed: ${steps || "none"}.`;
	const lead = typed.trim();
	const text = lead ? `${lead}\n\n${quote}` : quote;
	return text.length > RECHECK_CAP
		? `${text.slice(0, RECHECK_CAP - 1)}…`
		: text;
}
