// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineClosed } from "@prismalens/registry";
import {
	Activity,
	AlarmClock,
	Ban,
	Bell,
	BellOff,
	BellRing,
	Bot,
	CalendarClock,
	CheckCheck,
	Circle,
	CircleAlert,
	CircleCheck,
	CircleDashed,
	CircleHelp,
	CircleOff,
	CircleSlash,
	CircleStop,
	CircleX,
	Clock3,
	CornerDownRight,
	Eye,
	EyeOff,
	Flag,
	FolderGit2,
	FolderX,
	FoldVertical,
	Gauge,
	GitBranch,
	GitBranchMinus,
	GitBranchPlus,
	GitCompareArrows,
	GitFork,
	GitMerge,
	GitMergeConflict,
	GitPullRequest,
	GitPullRequestClosed,
	GitPullRequestDraft,
	Globe,
	History,
	Hourglass,
	Info,
	KeyRound,
	Layers,
	Link2,
	ListEnd,
	LockOpen,
	type LucideIcon,
	MessageCircleQuestion,
	MessageSquare,
	MessageSquareDiff,
	OctagonAlert,
	PauseCircle,
	Pencil,
	Puzzle,
	RefreshCw,
	RotateCcw,
	ScanEye,
	ShieldAlert,
	ShieldCheck,
	ShieldX,
	Signal,
	SignalHigh,
	SignalLow,
	SignalMedium,
	SquareTerminal,
	Trash2,
	TrendingUp,
	TriangleAlert,
	Unplug,
	Wifi,
	WifiOff,
} from "lucide-react";

/**
 * The closed set of metadata marks (#1125): one icon, an accessible label and a
 * tone per state, for status, agent, branch, PR or MR checks, children, asks,
 * limit and risk. The design owner fills `MARKS`; surfaces name the ones they show.
 */
export type MarkTone = "ok" | "warn" | "danger" | "info" | "muted";

export interface MarkDef<State extends string = string> {
	id: string;
	icon: LucideIcon;
	/** A state that changes the shape as well as the tone: a draft PR, a failed thread. */
	icons?: Readonly<Partial<Record<State, LucideIcon>>>;
	label: string;
	/** Each state in words, for the mark's hint; absent, the hint names only the mark. */
	words?: Readonly<Partial<Record<State, string>>>;
	tones: Readonly<Record<State, MarkTone>>;
}

export function defineMark<const M extends MarkDef>(mark: M): M {
	return mark;
}

/** Each tone's text class; only the mark's icon carries it (sheet §9.1). */
export const MARK_TONE_CLASS: Readonly<Record<MarkTone, string>> = {
	ok: "text-ok",
	warn: "text-warn",
	danger: "text-danger",
	info: "text-accent",
	muted: "text-text-3",
};

export const MARKS = {
	/** A thread's one status; warn for needs-you and Limited, danger for failed and Blocked. */
	status: defineMark({
		id: "status",
		icon: CircleDashed,
		icons: {
			approval: ShieldAlert,
			question: CircleHelp,
			blocked: Ban,
			failed: TriangleAlert,
			limited: Clock3,
			waiting: Hourglass,
			done: CircleCheck,
			settled: CheckCheck,
			idle: CircleDashed,
		},
		label: "Status",
		tones: {
			approval: "warn",
			question: "warn",
			blocked: "danger",
			failed: "danger",
			limited: "warn",
			working: "info",
			waiting: "muted",
			done: "muted",
			settled: "muted",
			idle: "muted",
		},
	}),
	/** The agent: its real mark is drawn by AgentMark; this is its fallback and label. */
	agent: defineMark({
		id: "agent",
		icon: Bot,
		label: "Agent",
		tones: { any: "muted" },
	}),
	/** A branch is an icon and a name, never coloured. */
	branch: defineMark({
		id: "branch",
		icon: GitBranch,
		label: "Branch",
		tones: { any: "muted" },
	}),
	/** A PR or MR by its state, checks folded in; the host's terms name it. */
	changeRequest: defineMark({
		id: "changeRequest",
		icon: GitPullRequest,
		icons: {
			draft: GitPullRequestDraft,
			merged: GitMerge,
			closed: GitPullRequestClosed,
		},
		label: "Change request",
		words: {
			failing: "checks failing",
			attention: "needs attention",
			ready: "ready to merge",
			open: "open",
			draft: "draft",
			merged: "merged",
			closed: "closed",
			unknown: "state unknown",
		},
		tones: {
			failing: "danger",
			attention: "warn",
			ready: "ok",
			open: "muted",
			draft: "muted",
			merged: "info",
			closed: "muted",
			unknown: "muted",
		},
	}),
	/** A PR or MR's checks, or one check, by result; the host's terms name them. */
	checks: defineMark({
		id: "checks",
		icon: CircleDashed,
		icons: { failing: CircleX, passing: CircleCheck },
		label: "Checks",
		tones: { failing: "danger", passing: "ok", pending: "muted" },
	}),
	/** A review or comment on a PR or MR, by its verdict. */
	review: defineMark({
		id: "review",
		icon: MessageSquare,
		icons: {
			approved: CircleCheck,
			changes_requested: MessageSquareDiff,
			review_required: Eye,
		},
		label: "Review",
		tones: {
			approved: "ok",
			changes_requested: "warn",
			commented: "muted",
			review_required: "muted",
		},
	}),
	/** Whether the PR or MR can merge into its base now (#1101 bar 15.1). */
	merge: defineMark({
		id: "merge",
		icon: GitMerge,
		icons: {
			conflicts: GitMergeConflict,
			blocked: Ban,
			behind: History,
			unstable: CircleDashed,
		},
		label: "Merge",
		tones: {
			clean: "ok",
			conflicts: "warn",
			blocked: "warn",
			behind: "warn",
			unstable: "warn",
		},
	}),
	/** The PR or MR no longer merges cleanly into its base. */
	conflict: defineMark({
		id: "conflict",
		icon: GitMergeConflict,
		label: "Merge conflict",
		tones: { conflict: "warn" },
	}),
	/** The thread's own worktree stuck in git (#1101 bar 15.1); `GIT_STATES` in contracts is the set. */
	gitState: defineMark({
		id: "gitState",
		icon: GitBranch,
		icons: {
			conflict: GitMergeConflict,
			rewritten: GitCompareArrows,
			gone: GitBranchMinus,
			moved: GitBranchPlus,
		},
		label: "Git",
		words: {
			conflict: "Conflict",
			rewritten: "Rewritten",
			gone: "Branch deleted",
			moved: "Remote moved",
		},
		tones: {
			conflict: "danger",
			rewritten: "warn",
			gone: "warn",
			moved: "warn",
		},
	}),
	/** Whether PrismaLens watches a PR's checks and reviews for the thread. */
	watch: defineMark({
		id: "watch",
		icon: ScanEye,
		icons: {
			waiting: Hourglass,
			disconnected: WifiOff,
			expired: EyeOff,
			stopped: EyeOff,
			off: EyeOff,
		},
		label: "Watch",
		tones: {
			watching: "info",
			waiting: "muted",
			disconnected: "warn",
			expired: "muted",
			stopped: "muted",
			off: "muted",
		},
	}),
	/** Who started a thread: another thread's agent, or a person's fork of it (#1101 cat 10). */
	startedBy: defineMark({
		id: "startedBy",
		icon: CornerDownRight,
		icons: { agent: CornerDownRight, fork: GitFork },
		label: "Started by",
		words: { agent: "Started by", fork: "Forked from" },
		tones: { agent: "muted", fork: "muted" },
	}),
	/** Whether this browser may show notifications; the fix rides in the hint. */
	notify: defineMark({
		id: "notify",
		icon: Bell,
		icons: {
			granted: BellRing,
			denied: BellOff,
			insecure: LockOpen,
			unsupported: CircleOff,
		},
		label: "Browser notifications",
		tones: {
			granted: "ok",
			default: "warn",
			denied: "danger",
			insecure: "danger",
			unsupported: "muted",
		},
	}),
	/** A message sent while the agent works: queued for its next pause, or steered in now. */
	delivery: defineMark({
		id: "delivery",
		icon: ListEnd,
		icons: { steered: CornerDownRight },
		label: "Delivery",
		tones: { queued: "muted", steered: "info" },
	}),
	/** Who sent an incoming message: the source's shape and word, never "You" (#1101 cat 9). */
	inbound: defineMark({
		id: "inbound",
		icon: MessageSquare,
		icons: {
			child: CornerDownRight,
			schedule: CalendarClock,
			pr: GitPullRequest,
			wake: AlarmClock,
		},
		label: "Sent by",
		words: {
			child: "A thread you started",
			thread: "Another thread",
			schedule: "Your schedule",
			pr: "Pull request update",
			wake: "Wake-up",
		},
		tones: {
			child: "muted",
			thread: "muted",
			schedule: "muted",
			pr: "muted",
			wake: "info",
		},
	}),
	/** The cap on messages between two threads stopped a loop: later ones wait unread (#1101 cat 10). */
	pairCap: defineMark({
		id: "pairCap",
		icon: PauseCircle,
		label: "Message loop stopped",
		words: {
			sent: "This message and later ones stay unread: these two threads reached today's message cap",
			received:
				"This message woke nothing: these two threads reached today's message cap",
		},
		tones: { sent: "warn", received: "warn" },
	}),
	/** Threads that changed while the reader was away: a count, quiet until opened. */
	away: defineMark({
		id: "away",
		icon: History,
		label: "Changed while you were away",
		tones: { any: "muted" },
	}),
	/** An open ask: loudest on the row, and it lifts a parent into needs-you. */
	ask: defineMark({
		id: "ask",
		icon: MessageCircleQuestion,
		icons: { approval: ShieldAlert },
		label: "Waiting for you",
		tones: { question: "warn", approval: "warn" },
	}),
	/** A call the run's mode answered without asking: approved, or blocked. */
	decided: defineMark({
		id: "decided",
		icon: ShieldCheck,
		icons: { blocked: ShieldX },
		label: "Decided for you",
		tones: { approved: "ok", blocked: "danger" },
	}),
	/** A break in a thread, drawn as a dash on the transcript rail and named in its card. */
	break: defineMark({
		id: "break",
		icon: FoldVertical,
		icons: { limit: Clock3, failure: TriangleAlert, restart: RotateCcw },
		label: "Break",
		tones: {
			limit: "warn",
			failure: "danger",
			restart: "info",
			compaction: "muted",
		},
	}),
	/** A provider stop: Limited waits on a clock, Blocked on the user. */
	limit: defineMark({
		id: "limit",
		icon: Clock3,
		icons: { blocked: Ban },
		label: "Usage limit",
		tones: { limited: "warn", blocked: "danger" },
	}),
	/** A usage window: amber near its limit, red once full by the rule that parks a thread (`usageWindowState`). */
	usage: defineMark({
		id: "usage",
		icon: Gauge,
		icons: { near: TriangleAlert, full: Clock3, unreported: CircleSlash },
		label: "Usage window",
		tones: {
			room: "info",
			near: "warn",
			full: "danger",
			unknown: "muted",
			unreported: "muted",
		},
	}),
	/** An answer sent from a card: green only once the host took it, red with a retry when it did not. */
	answer: defineMark({
		id: "answer",
		icon: CircleDashed,
		icons: { delivered: CircleCheck, failed: TriangleAlert },
		label: "Your answer",
		tones: { sending: "info", delivered: "ok", failed: "danger" },
	}),
	/** A risky edit in a turn: tests, CI, coverage, migrations, secrets, permissions (#1110). */
	risk: defineMark({
		id: "risk",
		icon: Flag,
		label: "Risky change",
		tones: { flagged: "warn", blocker: "danger" },
	}),
	/** What an asked-for call can touch; only run, network and delete are tinted. */
	reach: defineMark({
		id: "reach",
		icon: Eye,
		icons: {
			write: Pencil,
			delete: Trash2,
			run: SquareTerminal,
			network: Globe,
			other: CircleHelp,
		},
		label: "Reach",
		tones: {
			read: "muted",
			write: "muted",
			delete: "danger",
			run: "warn",
			network: "warn",
			other: "muted",
		},
	}),
	/** Whether the chosen agent can take a run; it never blocks typing. */
	agentReady: defineMark({
		id: "agentReady",
		icon: CircleCheck,
		icons: { signIn: KeyRound, missing: CircleOff },
		label: "Agent",
		tones: { ready: "ok", signIn: "warn", missing: "muted" },
	}),
	/** An incident's or alert's severity: the bars count down with the level. */
	severity: defineMark({
		id: "severity",
		icon: Info,
		icons: {
			critical: Signal,
			high: SignalHigh,
			medium: SignalMedium,
			low: SignalLow,
		},
		label: "Severity",
		tones: {
			critical: "danger",
			high: "warn",
			medium: "warn",
			low: "muted",
			info: "muted",
		},
	}),
	/** What an incident's alerts are doing now. */
	firing: defineMark({
		id: "firing",
		icon: Activity,
		icons: { worse: TrendingUp, clear: BellOff, none: BellOff },
		label: "Alerts",
		tones: { worse: "danger", steady: "warn", clear: "muted", none: "muted" },
	}),
	/** One alert's status; a suppressed alert keeps recording. */
	alert: defineMark({
		id: "alert",
		icon: Bell,
		icons: {
			triggered: BellRing,
			correlated: Link2,
			suppressed: BellOff,
		},
		label: "Alert",
		tones: {
			triggered: "danger",
			acknowledged: "warn",
			correlated: "info",
			resolved: "muted",
			suppressed: "muted",
		},
	}),
	/** A service's health: the worst open severity; silent is hollow and never green. */
	health: defineMark({
		id: "health",
		icon: CircleCheck,
		icons: { degraded: CircleAlert, down: OctagonAlert, silent: Circle },
		label: "Health",
		tones: { ok: "ok", degraded: "warn", down: "danger", silent: "muted" },
	}),
	/** This device's live link to the computer running PrismaLens. */
	connection: defineMark({
		id: "connection",
		icon: Wifi,
		icons: {
			connecting: CircleDashed,
			reconnecting: RefreshCw,
			unreachable: WifiOff,
		},
		label: "Connection",
		tones: {
			connected: "ok",
			connecting: "muted",
			reconnecting: "warn",
			unreachable: "danger",
		},
	}),
	/** Whether a run can read the subject's code. */
	code: defineMark({
		id: "code",
		icon: FolderGit2,
		icons: { missing: FolderX },
		label: "Code",
		tones: { linked: "muted", missing: "warn" },
	}),
	/** Repeats folded into one row, shown as ×N. */
	repeats: defineMark({
		id: "repeats",
		icon: Layers,
		label: "Repeats",
		tones: { any: "muted" },
	}),
	/** What an agent sent that this host does not know: a newer protocol, or an update kind (#1101). */
	drift: defineMark({
		id: "drift",
		icon: Puzzle,
		icons: { protocol: Unplug },
		label: "Not known to PrismaLens",
		tones: { protocol: "warn", update: "muted" },
	}),
	/** One run's outcome: a sub-agent or a scheduled run. A working run draws the ring. */
	run: defineMark({
		id: "run",
		icon: CircleDashed,
		icons: {
			pending: Hourglass,
			completed: CircleCheck,
			failed: TriangleAlert,
			cancelled: CircleStop,
		},
		label: "Run",
		tones: {
			running: "info",
			pending: "muted",
			completed: "muted",
			failed: "danger",
			cancelled: "muted",
		},
	}),
} as const satisfies Readonly<Record<string, MarkDef>>;

export type MarkId = keyof typeof MARKS & string;

/** One mark's states, from its tones: a break kind is `MarkState<"break">`. */
export type MarkState<Id extends MarkId> = keyof (typeof MARKS)[Id]["tones"] &
	string;

/** Each tone as a fill, for a mark drawn as a dash or dot rather than an icon. */
export const MARK_TONE_FILL: Readonly<Record<MarkTone, string>> = {
	ok: "bg-ok",
	warn: "bg-warn",
	danger: "bg-danger",
	info: "bg-info",
	muted: "bg-text-3",
};

/** A mark's fill class for one state; an unknown state reads muted. */
export function markFill(id: MarkId, state: string): string {
	const m: MarkDef = MARKS[id];
	return MARK_TONE_FILL[m.tones[state] ?? "muted"];
}

/** A mark's icon and tone class for one state; an unknown state reads muted with the base icon. */
export function markLook(
	id: MarkId,
	state = "any",
): { icon: LucideIcon; className: string; label: string; word?: string } {
	const m: MarkDef = MARKS[id];
	const word = m.words?.[state];
	return {
		icon: m.icons?.[state] ?? m.icon,
		className: MARK_TONE_CLASS[m.tones[state] ?? "muted"],
		label: m.label,
		...(word ? { word } : {}),
	};
}

export type Reach = "read" | "write" | "delete" | "run" | "network" | "other";

/** An ACP tool kind as a reach, with its words for the hint. */
export function reachOf(toolKind: string | null | undefined): {
	state: Reach;
	word: string;
} {
	switch (toolKind) {
		case "read":
		case "search":
			return { state: "read", word: "Reads files" };
		case "edit":
		case "move":
			return { state: "write", word: "Edits files" };
		case "delete":
			return { state: "delete", word: "Deletes files" };
		case "execute":
			return { state: "run", word: "Runs a command" };
		case "fetch":
			return { state: "network", word: "Reaches the network" };
		default:
			return { state: "other", word: "Other action" };
	}
}

/** The marks as a closed kind: a surface's `marks` must name one of these (#1125). */
export const markSet = defineClosed(
	"mark",
	Object.keys(MARKS) as MarkId[],
	MARKS,
);
