// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	IncidentWithRelations,
	TimelineEntryWithRelations,
} from "@prismalens/contracts";
import { createContext, useContext } from "react";
import type { InvestigationRun } from "@/components/investigation/useInvestigationRun";

export type RunRef = NonNullable<
	IncidentWithRelations["investigations"]
>[number];

/**
 * What every layer under an incident shares (#743 §3c): the incident, the run
 * the band and strip follow, and the actions its cards and routes offer. Built
 * once by the incident's layout route so the strip survives route changes.
 */
export interface IncidentRecord {
	incident: IncidentWithRelations;
	runs: RunRef[];
	investigationId: string | null;
	selectRun: (id: string) => void;
	run: InvestigationRun;
	/** Investigate is admitted: the incident is open and no run is live. */
	canInvestigate: boolean;
	/** Why no agent can run right now, when none can. */
	investigateBlocked?: string;
	/** Starts a run; resolves once the API took it, rejects with its refusal. */
	investigate: (start?: {
		brief?: string;
		/** The agent's own mode id; the agent's default when absent (#673 w21). */
		agentMode?: string;
		attachments?: string[];
	}) => Promise<void>;
	isInvestigating: boolean;
	acknowledge: () => void;
	resolve: () => void;
	/** The operator's one step, Resolve (R1a): opens the dialog prefilled from the report. */
	openClose: () => void;
	/** Edit the recorded cause after Resolve (R1a d3). */
	openEditCause: () => void;
	/** Ask to reopen a resolved incident; it starts no run. */
	openReopen: () => void;
	addNote: (text: string, onDone?: () => void) => void;
	isSavingNote: boolean;
	timeline: TimelineEntryWithRelations[];
	timelineLoading: boolean;
}

export const IncidentRecordContext = createContext<IncidentRecord | null>(null);

export function useIncidentRecord(): IncidentRecord {
	const record = useContext(IncidentRecordContext);
	if (!record) {
		throw new Error("useIncidentRecord outside an incident's layout route");
	}
	return record;
}
