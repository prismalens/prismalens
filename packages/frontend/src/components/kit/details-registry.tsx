// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ArrowDown,
	ArrowUp,
	BellRing,
	CalendarClock,
	CornerLeftUp,
	Eye,
	FileDiff,
	Gauge,
	GitBranch,
	GitFork,
	GitMerge,
	GitPullRequest,
	Lightbulb,
	Monitor,
	SignalHigh,
	SquareTerminal,
} from "lucide-react";
import type { ReactNode } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import { Hint } from "@/components/shared/Hint";
import type { DetailsRow } from "./details";
import { Mark } from "./Mark";

type PrTone = "failing" | "attention" | "passing" | "running" | "merged";
const PR_TONE: Record<PrTone, DetailsRow["tone"]> = {
	failing: "danger",
	attention: "warn",
	// The PR's state is its icon's colour (thread-panel research): passing green, merged accent.
	passing: "ok",
	running: "accent",
	merged: "accent",
};

/** Commits ahead of and behind the upstream: `↑a ↓b`, the words in the hint. */
function SyncMarks({ ahead, behind }: { ahead: number; behind: number }) {
	if (!ahead && !behind) return null;
	const words = [ahead && `${ahead} to push`, behind && `${behind} to pull`]
		.filter(Boolean)
		.join(", ");
	return (
		<Hint label={words}>
			<span
				className="flex items-center gap-1.5 font-mono text-mono text-text-2 tabular-nums"
				data-testid="details-sync"
			>
				{ahead > 0 && (
					<span className="flex items-center">
						<ArrowUp aria-hidden className="size-3" />
						{ahead}
					</span>
				)}
				{behind > 0 && (
					<span className="flex items-center">
						<ArrowDown aria-hidden className="size-3" />
						{behind}
					</span>
				)}
				<span className="sr-only">{words}</span>
			</span>
		</Hint>
	);
}

export interface DetailsPr {
	number: number;
	/** The PR's state word: Failing, Changes requested, Passing, Merged. */
	word: string;
	tone: PrTone;
	/** Checks as `7/9`, shown after the word. */
	checks?: string;
	/** Read without opening the PR (#1101 bar 15.1): title, branch pair, verdict, merge state. */
	title?: string;
	branches?: { head: string; base: string };
	/** A `review` mark state and its word, e.g. `approved`, "Approved". */
	review?: { state: string; word: string };
	/** A `merge` mark state and its word, e.g. `conflicts`, "Merge conflict". */
	merge?: { state: string; word: string };
}

/** A chat or project thread (pattern sheet §3). Absent fields drop their row. */
export interface ThreadDetails {
	kind: "thread";
	machine?: string;
	agent: { id: string; name: string; model?: string };
	branch?: string;
	/** Commits against the branch's upstream; absent with none. */
	sync?: { ahead: number; behind: number };
	changes?: { added: number; removed: number };
	pr?: DetailsPr;
	parent?: string;
	children?: { count: number; working: number };
	watching?: string;
	schedule?: string;
	/** Share of the context window used, 0 to 100. */
	context?: number;
	/** The card's one git action and its openers, drawn by the thread page. */
	actions?: ReactNode;
	/** Live child rows in place of the children count, `span` lines tall. */
	lineage?: { node: ReactNode; span: number };
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

/** The PR's row, then its branch pair; the title truncates before any mark. */
const prRows = (
	pr: DetailsPr,
	priority: 1 | 2,
	onOpen?: () => void,
): DetailsRow[] => [
	{
		id: "pr",
		group: "code",
		priority,
		icon: pr.tone === "merged" ? GitMerge : GitPullRequest,
		tone: PR_TONE[pr.tone],
		label: (
			<>
				<span className="tabular-nums">#{pr.number}</span>
				{pr.title && (
					<span className="text-text-2" data-testid="details-pr-title">
						{" "}
						{pr.title}
					</span>
				)}
			</>
		),
		value: (
			<span className="flex items-center gap-1.5 text-text-2">
				{pr.review && (
					<Mark
						id="review"
						state={pr.review.state}
						word={pr.review.word}
						testId="details-pr-review"
					/>
				)}
				{pr.merge && (
					<Mark
						id="merge"
						state={pr.merge.state}
						word={pr.merge.word}
						testId="details-pr-merge"
					/>
				)}
				<span>
					{pr.word}
					{pr.checks && ` ${pr.checks}`}
				</span>
			</span>
		),
		onOpen,
	},
	...(pr.branches
		? [
				{
					id: "pr-branches",
					group: "code",
					priority: 3,
					icon: GitBranch,
					label: (
						<span className="inline-flex min-w-0 items-center gap-1">
							<span className="truncate">{pr.branches.head}</span>
							<GitMerge aria-hidden className="size-3 shrink-0 text-text-3" />
							<span className="sr-only">merges into</span>
							<span className="shrink-0">{pr.branches.base}</span>
						</span>
					),
					mono: true,
					onOpen,
				} satisfies DetailsRow,
			]
		: []),
];

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
			...(d.sync
				? { value: <SyncMarks ahead={d.sync.ahead} behind={d.sync.behind} /> }
				: {}),
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
		...(d.pr ? prRows(d.pr, 1, d.open?.pr) : []),
		d.actions !== undefined && {
			id: "actions",
			group: "code",
			priority: 1,
			label: null,
			control: d.actions,
		},
		d.parent !== undefined && {
			id: "parent",
			group: "lineage",
			priority: 2,
			icon: CornerLeftUp,
			label: d.parent,
			onOpen: d.open?.parent,
		},
		d.lineage && {
			id: "children",
			group: "lineage",
			priority: 2,
			label: null,
			control: d.lineage.node,
			span: d.lineage.span,
		},
		!d.lineage &&
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
		...(d.pr ? prRows(d.pr, 2, d.open?.pr) : []),
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
