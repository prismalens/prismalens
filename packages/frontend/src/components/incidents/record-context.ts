// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessId } from "@prismalens/config/harness";
import type {
	IncidentWithRelations,
	TimelineEntryWithRelations,
} from "@prismalens/contracts";
import { createContext, useContext } from "react";
import type { InvestigationRun } from "@/components/investigation/useInvestigationRun";

export type RunRef = NonNullable<
	IncidentWithRelations["investigations"]
>[number];

/** `?investigation=new`: the draft of a run not sent yet (#673). */
export const DRAFT = "new";

/**
 * The draft's chips (#673 w52): what this run asks for, never written to Settings.
 * A field left unset reads Settings; `model: ""` and `effort: null` ask for the agent's own.
 */
export interface DraftChoice {
	harness?: HarnessId;
	model?: string;
	effort?: string | null;
	mode?: string;
}

export interface RunStart {
	text?: string;
	/** The agent's own mode id; the agent's default when absent (#673 w21). */
	agentMode?: string;
	attachments?: string[];
	harness?: HarnessId;
	model?: string;
	effort?: string | null;
}

/** What every layer under an incident shares: the incident, its runs, the selected run and the draft. */
export interface IncidentRecord {
	incident: IncidentWithRelations;
	/** Newest first. */
	runs: RunRef[];
	investigationId: string | null;
	/** The draft is selected rather than a run. */
	draft: boolean;
	selectRun: (id: string) => void;
	/** Opens Conversation on the draft; `prefill` replaces its chips. */
	newRun: (prefill?: DraftChoice) => void;
	/** The draft's chips and text, kept per incident while the page lives. */
	draftChoice: DraftChoice;
	setDraftChoice: (choice: DraftChoice) => void;
	draftText: string;
	setDraftText: (text: string) => void;
	run: InvestigationRun;
	/** A run is working on this incident; the draft waits for it. */
	liveRun: RunRef | null;
	/** Why no agent can run right now, when none can. */
	investigateBlocked?: string;
	/** Gathers, then starts the agent; resolves once the API took it. */
	investigate: (start?: RunStart) => Promise<void>;
	/** Asks without gathering: a chat run (POST /incidents/{id}/chat). */
	chat: (start: RunStart & { text: string }) => Promise<void>;
	isStarting: boolean;
	acknowledge: () => void;
	resolve: () => void;
	openClose: () => void;
	openEditCause: () => void;
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
