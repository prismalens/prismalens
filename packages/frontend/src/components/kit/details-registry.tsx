// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ArrowDown,
	ArrowUp,
	BellRing,
	Bot,
	CalendarClock,
	Eye,
	FileDiff,
	FolderGit2,
	GitBranch,
	GitMerge,
	GitPullRequest,
	Lightbulb,
	Monitor,
	SignalHigh,
	SquareTerminal,
} from "lucide-react";
import type { ReactNode } from "react";
import { Hint } from "@/components/shared/Hint";
import { type BoxSlot, boxHeight, type DetailsRow } from "./details";
import { Mark } from "./Mark";
import { MARKS } from "./marks";

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

/**
 * A chat or project thread (pattern sheet §3). Absent fields become a quiet line, never a
 * missing row, so the box holds still. The agent and model are the composer's facts.
 */
export interface ThreadDetails {
	kind: "thread";
	machine?: string;
	/** The project's name, else the folder it works in; `path` is the full folder. */
	place?: { name: string; path?: string };
	/** The folder opener, drawn by the thread page. */
	folder?: ReactNode;
	branch?: string;
	/** Commits against the branch's upstream; absent with none. */
	sync?: { ahead: number; behind: number };
	changes?: { added: number; removed: number };
	pr?: DetailsPr;
	/** Who started it, or the thread a person forked it from (#1101 cat 10). */
	startedBy?: { title: string; via: "agent" | "fork" };
	/** How many threads it started. */
	started?: number;
	/** Sub-agents running now. */
	running?: number;
	watching?: string;
	schedule?: string;
	/** The card's one git action, drawn by the thread page. */
	actions?: ReactNode;
	open?: Partial<
		Record<"diff" | "pr" | "startedBy" | "started" | "subagents", () => void>
	>;
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
	group = "work",
): DetailsRow[] => [
	{
		id: "pr",
		fact: "pr",
		group,
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
				<span className="whitespace-nowrap">
					{[pr.word, pr.checks].filter(Boolean).join(" ")}
				</span>
			</span>
		),
		onOpen,
	},
	...(pr.branches
		? [
				{
					id: "pr-branches",
					fact: "branch",
					group,
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

const quiet = (
	id: string,
	group: string,
	icon: DetailsRow["icon"],
	label: string,
): DetailsRow => ({ id, group, priority: 1, icon, label, quiet: true });

function threadRows(d: ThreadDetails): DetailsRow[] {
	const rows: (DetailsRow | false | undefined)[] = [
		d.branch !== undefined
			? {
					id: "branch",
					fact: "branch",
					group: "work",
					priority: 1,
					icon: GitBranch,
					label: d.branch,
					mono: true,
					...(d.sync
						? {
								value: (
									<SyncMarks ahead={d.sync.ahead} behind={d.sync.behind} />
								),
							}
						: {}),
				}
			: undefined,
		d.changes
			? {
					id: "changes",
					fact: "changes",
					group: "work",
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
				}
			: undefined,
		...(d.pr ? prRows(d.pr, 1, d.open?.pr) : []),
		// One quiet line for a thread with no code work yet; a missing row otherwise stays blank.
		d.branch === undefined &&
			!d.changes &&
			!d.pr &&
			quiet("work", "work", FileDiff, "No code changes yet"),
		d.place
			? {
					id: "place",
					fact: "folder",
					group: "place",
					priority: 1,
					icon: FolderGit2,
					label: d.place.path ? (
						<Hint label={d.place.path}>
							<span className="truncate" data-testid="details-place-name">
								{d.place.name}
							</span>
						</Hint>
					) : (
						d.place.name
					),
					...(d.folder ? { value: d.folder } : {}),
				}
			: quiet("place", "place", FolderGit2, "No folder"),
		d.machine !== undefined && {
			id: "machine",
			fact: "host",
			group: "place",
			priority: 1,
			icon: Monitor,
			label: d.machine,
		},
		d.actions !== undefined && {
			id: "actions",
			group: "next",
			priority: 1,
			label: null,
			control: d.actions,
		},
		d.startedBy !== undefined && {
			id: "startedBy",
			fact: "startedBy",
			group: "lineage",
			priority: 1,
			icon: MARKS.startedBy.icons[d.startedBy.via],
			label: (
				<Hint
					label={`${MARKS.startedBy.words[d.startedBy.via]} ${d.startedBy.title}`}
				>
					<span className="truncate" data-testid="details-started-by">
						{d.startedBy.title}
					</span>
				</Hint>
			),
			onOpen: d.open?.startedBy,
		},
		!!d.running && {
			id: "subagents",
			group: "lineage",
			priority: 2,
			icon: Bot,
			label: "Sub-agents",
			value: (
				<span className="text-text-2 tabular-nums">{d.running} running</span>
			),
			onOpen: d.open?.subagents,
		},
		!!d.started && {
			id: "started",
			group: "lineage",
			priority: 2,
			icon: MARKS.startedBy.icons.agent,
			label: "Started",
			value: (
				<span className="text-text-2 tabular-nums">
					{d.started} {d.started === 1 ? "thread" : "threads"}
				</span>
			),
			onOpen: d.open?.started,
		},
		d.schedule !== undefined && {
			id: "schedule",
			fact: "schedule",
			group: "lineage",
			priority: 3,
			icon: CalendarClock,
			label: d.schedule,
		},
		d.watching !== undefined && {
			id: "watching",
			group: "lineage",
			priority: 3,
			icon: Eye,
			label: d.watching,
		},
	];
	return rows.filter((r): r is DetailsRow => Boolean(r));
}

function incidentRows(d: IncidentDetails): DetailsRow[] {
	const rows: (DetailsRow | false | undefined)[] = [
		{
			id: "severity",
			fact: "severity",
			group: "finding",
			priority: 1,
			icon: SignalHigh,
			tone: d.severity.tone,
			label: "Severity",
			value: <span className="text-text-2">{d.severity.word}</span>,
		},
		d.cause !== undefined && {
			id: "cause",
			fact: "cause",
			group: "finding",
			priority: 1,
			icon: Lightbulb,
			label: d.cause,
			lines: 2,
		},
		d.next !== undefined && {
			id: "next",
			fact: "next",
			group: "finding",
			priority: 1,
			icon: SquareTerminal,
			label: d.next,
			mono: true,
		},
		d.alert && {
			id: "alert",
			fact: "alert",
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
		...(d.pr ? prRows(d.pr, 2, d.open?.pr, "work") : []),
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

/**
 * Each kind's box: its slots top to bottom, rows reserved (#1101 category 21 item 6). The
 * next step sits last, so its button appearing never moves a row above it.
 */
export const DETAILS_LAYOUT: { [K in Details["kind"]]: readonly BoxSlot[] } = {
	thread: [
		{ id: "work", rows: 3 },
		{ id: "place", rows: 2 },
		{ id: "lineage", rows: 1 },
		{ id: "next", rows: 1 },
	],
	incident: [
		{ id: "finding", rows: 4 },
		{ id: "source", rows: 1 },
		{ id: "work", rows: 1 },
	],
};

/** One height for every kind's box, so the page never resizes it between threads. */
export const BOX_H = Math.max(
	...Object.values(DETAILS_LAYOUT).map((l) => boxHeight(l)),
);

export function detailsRows(d: Details): DetailsRow[] {
	return d.kind === "thread"
		? DETAILS_REGISTRY.thread(d)
		: DETAILS_REGISTRY.incident(d);
}
