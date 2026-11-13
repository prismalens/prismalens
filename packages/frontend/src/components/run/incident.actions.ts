// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { SEVERITY_LABEL, type Severity } from "@prismalens/contracts";
import {
	CircleCheck,
	Download,
	GitMerge,
	History,
	MessageSquarePlus,
	NotebookPen,
	PanelRight,
	RotateCw,
	Send,
	SquareArrowOutUpRight,
	SquarePen,
} from "lucide-react";
import { defineAction, type Facts } from "@/components/kit/actions";
import { markLook } from "@/components/kit/marks";

/** An incident or chat thread's page header: everything but its status and primary action. */
export interface IncidentCtx {
	toggleDetails: () => void;
	detailsLabel: string;
	allRuns: () => void;
	newConversation: () => void;
	resolve: () => void;
	note: () => void;
	statusUpdate: () => void;
	setSeverity: (s: Severity) => void;
	severity: Severity;
	investigateAgain: () => void;
	merge: () => void;
	exportReport: () => void;
	openMerged: () => void;
	editCause: () => void;
	facts: Facts<IncidentState>;
}

/** `chat`: a Home question, which has no severity, Resolve or merge. */
export type IncidentState =
	| "chat"
	| "hasRun"
	| "detailsOpen"
	| "manyRuns"
	| "resolvable"
	| "severityEditable"
	| "canInvestigateAgain"
	| "canMerge"
	| "hasReport"
	| "merged"
	| "closed";

declare module "@/components/kit/actions" {
	interface ObjectContexts {
		incident: IncidentCtx;
	}
	interface ObjectStates {
		incident: IncidentState;
	}
	interface ActionObjects {
		"incident.details": "incident";
		"incident.runs": "incident";
		"incident.newConversation": "incident";
		"incident.resolve": "incident";
		"incident.note": "incident";
		"incident.statusUpdate": "incident";
		"incident.severityCritical": "incident";
		"incident.severityHigh": "incident";
		"incident.severityMedium": "incident";
		"incident.severityLow": "incident";
		"incident.severityInfo": "incident";
		"incident.investigateAgain": "incident";
		"incident.merge": "incident";
		"incident.export": "incident";
		"incident.mergedInto": "incident";
		"incident.editCause": "incident";
	}
}

export const incidentDetails = defineAction({
	id: "incident.details",
	label: (c: IncidentCtx) => c.detailsLabel,
	icon: PanelRight,
	when: (f) => !!f.is?.hasRun,
	checked: (c) => !!c.facts.is?.detailsOpen,
	run: (c) => c.toggleDetails(),
});

export const incidentRuns = defineAction({
	id: "incident.runs",
	label: "All runs",
	icon: History,
	when: (f) => !!f.is?.manyRuns,
	run: (c) => c.allRuns(),
});

export const incidentNewConversation = defineAction({
	id: "incident.newConversation",
	label: "New conversation",
	icon: MessageSquarePlus,
	run: (c) => c.newConversation(),
});

export const incidentResolve = defineAction({
	id: "incident.resolve",
	label: "Resolve",
	icon: CircleCheck,
	when: (f) => !!f.is?.resolvable,
	run: (c) => c.resolve(),
});

export const incidentNote = defineAction({
	id: "incident.note",
	label: "Add a note",
	icon: NotebookPen,
	run: (c) => c.note(),
});

export const incidentStatusUpdate = defineAction({
	id: "incident.statusUpdate",
	label: "Write a status update",
	icon: Send,
	run: (c) => c.statusUpdate(),
});

/** One checked row per severity: the kit menu has no submenus. Ids stay literal for the registry generator. */
const severityRow = (s: Severity) => ({
	label: SEVERITY_LABEL[s],
	icon: markLook("severity", s).icon,
	when: (f: Facts<IncidentState>) => !!f.is?.severityEditable,
	checked: (c: IncidentCtx) => c.severity === s,
	run: (c: IncidentCtx) => c.setSeverity(s),
});

export const incidentSeverityCritical = defineAction({
	id: "incident.severityCritical",
	...severityRow("critical"),
});
export const incidentSeverityHigh = defineAction({
	id: "incident.severityHigh",
	...severityRow("high"),
});
export const incidentSeverityMedium = defineAction({
	id: "incident.severityMedium",
	...severityRow("medium"),
});
export const incidentSeverityLow = defineAction({
	id: "incident.severityLow",
	...severityRow("low"),
});
export const incidentSeverityInfo = defineAction({
	id: "incident.severityInfo",
	...severityRow("info"),
});

export const incidentInvestigateAgain = defineAction({
	id: "incident.investigateAgain",
	label: "Investigate again",
	icon: RotateCw,
	when: (f) => !!f.is?.canInvestigateAgain,
	run: (c) => c.investigateAgain(),
});

export const incidentMerge = defineAction({
	id: "incident.merge",
	label: "Merge into another incident",
	icon: GitMerge,
	when: (f) => !!f.is?.canMerge,
	run: (c) => c.merge(),
});

export const incidentExport = defineAction({
	id: "incident.export",
	label: "Export report as Markdown",
	icon: Download,
	when: (f) => !!f.is?.hasReport,
	run: (c) => c.exportReport(),
});

export const incidentMergedInto = defineAction({
	id: "incident.mergedInto",
	label: "Open the incident it merged into",
	icon: SquareArrowOutUpRight,
	when: (f) => !!f.is?.merged,
	run: (c) => c.openMerged(),
});

export const incidentEditCause = defineAction({
	id: "incident.editCause",
	label: "Edit cause",
	icon: SquarePen,
	when: (f) => !!f.is?.closed,
	run: (c) => c.editCause(),
});
