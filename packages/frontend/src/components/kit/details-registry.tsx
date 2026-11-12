// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	BellRing,
	CalendarClock,
	CornerLeftUp,
	Eye,
	FileDiff,
	Gauge,
	GitBranch,
	GitFork,
	GitPullRequest,
	Lightbulb,
	Monitor,
	SignalHigh,
	SquareTerminal,
} from "lucide-react";
import { AgentMark } from "@/components/agent/AgentMark";
import type { DetailsRow } from "./details";

type PrTone = "failing" | "attention" | "passing" | "running" | "merged";
const PR_TONE: Record<PrTone, DetailsRow["tone"]> = {
	failing: "danger",
	attention: "warn",
	passing: undefined,
	running: "accent",
	merged: undefined,
};

export interface DetailsPr {
	number: number;
	/** The PR's state word: Failing, Changes requested, Passing, Merged. */
	word: string;
	tone: PrTone;
	/** Checks as `7/9`, shown after the word. */
	checks?: string;
}

/** A chat or project thread (pattern sheet §3). Absent fields drop their row. */
export interface ThreadDetails {
	kind: "thread";
	machine?: string;
	agent: { id: string; name: string; model?: string };
	branch?: string;
	changes?: { added: number; removed: number };
	pr?: DetailsPr;
	parent?: string;
	children?: { count: number; working: number };
	watching?: string;
	schedule?: string;
	/** Share of the context window used, 0 to 100. */
	context?: number;
	open?: Partial<Record<"diff" | "pr" | "parent" | "children", () => void>>;
}

/** An incident thread: what an on-call reader needs first. */
export interface IncidentDetails {
	kind: "incident";
	severity: { word: string; tone: "danger" | "sev-high" | "warn" | "sev-low" };
	cause?: string;
	next?: string;
	alert?: { name: string; firing: boolean };
	pr?: DetailsPr;
	open?: Partial<Record<"alert" | "pr", () => void>>;
}

export type Details = ThreadDetails | IncidentDetails;

const prRow = (pr: DetailsPr, priority: 1 | 2, onOpen?: () => void) =>
	({
		id: "pr",
		group: "code",
		priority,
		icon: GitPullRequest,
		tone: PR_TONE[pr.tone],
		label: `#${pr.number}`,
		value: (
			<span className="text-text-2">
				{pr.word}
				{pr.checks && ` ${pr.checks}`}
			</span>
		),
		onOpen,
	}) satisfies DetailsRow;

function threadRows(d: ThreadDetails): DetailsRow[] {
	const rows: (DetailsRow | false | undefined)[] = [
		{
			id: "agent",
			group: "where",
			priority: 1,
			mark: <AgentMark id={d.agent.id} className="size-3.5" />,
			label: d.agent.model
				? `${d.agent.name} · ${d.agent.model}`
				: d.agent.name,
		},
		d.machine !== undefined && {
			id: "machine",
			group: "where",
			priority: 3,
			icon: Monitor,
			label: d.machine,
		},
		d.branch !== undefined && {
			id: "branch",
			group: "code",
			priority: 2,
			icon: GitBranch,
			label: d.branch,
			mono: true,
		},
		d.changes && {
			id: "changes",
			group: "code",
			priority: 1,
			icon: FileDiff,
			label: "Changes",
			value: (
				<span className="font-mono text-mono">
					<span className="text-ok">+{d.changes.added}</span>{" "}
					<span className="text-danger">−{d.changes.removed}</span>
				</span>
			),
			onOpen: d.open?.diff,
		},
		d.pr && prRow(d.pr, 1, d.open?.pr),
		d.parent !== undefined && {
			id: "parent",
			group: "lineage",
			priority: 2,
			icon: CornerLeftUp,
			label: d.parent,
			onOpen: d.open?.parent,
		},
		d.children && {
			id: "children",
			group: "lineage",
			priority: 3,
			icon: GitFork,
			label: `${d.children.count} ${d.children.count === 1 ? "child" : "children"}`,
			value: d.children.working ? (
				<span className="text-text-2">{d.children.working} working</span>
			) : undefined,
			onOpen: d.open?.children,
		},
		d.watching !== undefined && {
			id: "watching",
			group: "watch",
			priority: 3,
			icon: Eye,
			label: d.watching,
		},
		d.schedule !== undefined && {
			id: "schedule",
			group: "watch",
			priority: 3,
			icon: CalendarClock,
			label: d.schedule,
		},
		d.context !== undefined && {
			id: "context",
			group: "context",
			priority: 2,
			icon: Gauge,
			label: "Context",
			value: <span className="text-text-2">{d.context}%</span>,
		},
	];
	return rows.filter((r): r is DetailsRow => Boolean(r));
}

function incidentRows(d: IncidentDetails): DetailsRow[] {
	const rows: (DetailsRow | false | undefined)[] = [
		{
			id: "severity",
			group: "finding",
			priority: 1,
			icon: SignalHigh,
			tone: d.severity.tone,
			label: "Severity",
			value: <span className="text-text-2">{d.severity.word}</span>,
		},
		d.cause !== undefined && {
			id: "cause",
			group: "finding",
			priority: 1,
			icon: Lightbulb,
			label: d.cause,
			lines: 2,
		},
		d.next !== undefined && {
			id: "next",
			group: "finding",
			priority: 1,
			icon: SquareTerminal,
			label: d.next,
			mono: true,
		},
		d.alert && {
			id: "alert",
			group: "source",
			priority: 2,
			icon: BellRing,
			label: d.alert.name,
			value: (
				<span className="text-text-2">
					{d.alert.firing ? "Firing" : "Resolved"}
				</span>
			),
			onOpen: d.open?.alert,
		},
		d.pr && prRow(d.pr, 2, d.open?.pr),
	];
	return rows.filter((r): r is DetailsRow => Boolean(r));
}

/** The per-kind registry (pattern sheet §3): a new kind adds one builder here. */
export const DETAILS_REGISTRY: {
	[K in Details["kind"]]: (d: Extract<Details, { kind: K }>) => DetailsRow[];
} = {
	thread: threadRows,
	incident: incidentRows,
};

export function detailsRows(d: Details): DetailsRow[] {
	return d.kind === "thread"
		? DETAILS_REGISTRY.thread(d)
		: DETAILS_REGISTRY.incident(d);
}
