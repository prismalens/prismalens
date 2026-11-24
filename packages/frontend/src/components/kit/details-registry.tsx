// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { StartedByVia } from "@prismalens/contracts";
import {
	ArrowDown,
	ArrowUp,
	BellRing,
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
	/** A worktree on no branch: its tip's short sha (#1176 F2). */
	detached?: string;
	/** The branch that worktree was cut from: a run's copy is detached on purpose. */
	from?: string;
	/** Commits against the branch's upstream; absent with none. */
	sync?: { ahead: number; behind: number };
	changes?: { added: number; removed: number };
	pr?: DetailsPr;
	/** Who started it, or the thread a person forked it from (#1101 cat 10). */
	startedBy?: { title: string; via: StartedByVia };
	/** Threads and sub-agents it started, from stored state (#1176 D16). */
	started?: number;
	/** Of those, the ones running now. */
	running?: number;
	watching?: string;
	schedule?: string;
	/** The card's one git action, drawn by the thread page. */
	actions?: ReactNode;
	open?: Partial<Record<"diff" | "pr" | "startedBy" | "started", () => void>>;
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
		// Number and checks read whole at the box's width; the title is the hover's (#1101 cat 21).
		label: (
			<Hint label={pr.title ?? `#${pr.number}`}>
				<span className="truncate tabular-nums">
					#{pr.number}
					<span className="text-text-2">
						{[pr.word, pr.checks]
							.filter(Boolean)
							.map((w) => ` · ${w}`)
							.join("")}
					</span>
					{pr.title && (
						<span className="sr-only" data-testid="details-pr-title">
							{" "}
							{pr.title}
						</span>
					)}
				</span>
			</Hint>
		),
		...(pr.review || pr.merge
			? {
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
						</span>
					),
				}
			: {}),
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
		(d.branch !== undefined || d.detached !== undefined) && {
			id: "branch",
			fact: "branch",
			group: "work",
			priority: 1,
			icon: GitBranch,
			label: d.branch ?? (
				<Hint label="No branch yet. Commits here can't be pushed until one is made.">
					<span className="truncate" data-testid="details-detached">
						{d.from
							? `Run copy of ${d.from} at ${d.detached}`
							: `Detached at ${d.detached}`}
					</span>
				</Hint>
			),
			mono: true,
			...(d.sync
				? {
						value: <SyncMarks ahead={d.sync.ahead} behind={d.sync.behind} />,
					}
				: {}),
		},
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
		// With no folder either, one line says both (#1101 cat 21: the box never reads as broken).
		d.branch === undefined &&
			d.detached === undefined &&
			!d.changes &&
			!d.pr &&
			quiet(
				"work",
				"work",
				FileDiff,
				d.place ? "No code changes yet" : "No code or folder yet",
			),
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
			: d.branch !== undefined || d.detached !== undefined || d.changes || d.pr
				? quiet("place", "place", FolderGit2, "No folder")
				: undefined,
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
			fact: "next",
			group: "tail",
			priority: 1,
			label: null,
			control: d.actions,
		},
		// Who started it is the sidebar row's and the header's link; the box leaves it out (#1101).
		!!d.started && {
			id: "started",
			group: "tail",
			priority: 2,
			icon: MARKS.startedBy.icons.agent,
			label: "Started",
			value: (
				<span
					className="text-text-2 tabular-nums"
					data-testid="details-row-started"
				>
					{d.started}
					{d.running ? ` · ${d.running} running` : ""}
				</span>
			),
			onOpen: d.open?.started,
		},
		d.schedule !== undefined && {
			id: "schedule",
			fact: "schedule",
			group: "tail",
			priority: 3,
			icon: CalendarClock,
			label: d.schedule,
		},
		d.watching !== undefined && {
			id: "watching",
			group: "tail",
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
 * Each kind's box: its slots top to bottom, rows reserved (#1101 category 21 item 6). It is
 * sized to the fullest common state (branch, changes, PR, place); the rare next step and
 * lineage share one last row that scrolls, the step first, so the box never sits mostly empty.
 */
export const DETAILS_LAYOUT: { [K in Details["kind"]]: readonly BoxSlot[] } = {
	thread: [
		{ id: "work", rows: 3 },
		{ id: "place", rows: 2 },
		{ id: "tail", rows: 1, scroll: true },
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
