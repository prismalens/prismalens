// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel, HarnessId } from "@prismalens/config/harness";
import type {
	IncidentWithRelations,
	TimelineEntryWithRelations,
} from "@prismalens/contracts";
import { createContext, useContext } from "react";
import type { InvestigationRun } from "@/components/investigation/useInvestigationRun";
import type { RunVerb } from "@/lib/run-verb";

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
	accessLevel?: AccessLevel;
}

/** What `+ New run` opens with: chips, a verb, text and files (#673 w59). */
export interface NewRunPrefill {
	choice?: DraftChoice;
	verb?: RunVerb;
	text?: string;
	files?: File[];
}

export interface RunStart {
	text?: string;
	/** This run's level; Settings, else the agent's own default, when absent (#673 w21). */
	accessLevel?: AccessLevel;
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
	/** Opens Conversation on the draft; what `prefill` names replaces the draft's own. */
	newRun: (prefill?: NewRunPrefill) => void;
	/** The draft's chips, text, verb and files, kept per incident while the page lives. */
	draftChoice: DraftChoice;
	setDraftChoice: (choice: DraftChoice) => void;
	draftText: string;
	setDraftText: (text: string) => void;
	/** Unset until the operator picks one; the box then reads its default. */
	draftVerb?: RunVerb;
	setDraftVerb: (verb: RunVerb) => void;
	/** Files carried into the draft; the box takes them once, on mount. */
	draftFiles: File[];
	setDraftFiles: (files: File[]) => void;
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
