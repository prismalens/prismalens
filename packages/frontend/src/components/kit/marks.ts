// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Activity,
	Ban,
	Bell,
	BellOff,
	BellRing,
	Bot,
	CheckCheck,
	Circle,
	CircleAlert,
	CircleCheck,
	CircleDashed,
	CircleHelp,
	CircleOff,
	Clock3,
	Eye,
	EyeOff,
	Flag,
	FolderGit2,
	FolderX,
	GitBranch,
	GitMerge,
	GitPullRequest,
	GitPullRequestClosed,
	GitPullRequestDraft,
	Globe,
	Hourglass,
	Info,
	KeyRound,
	Layers,
	Link2,
	type LucideIcon,
	MessageCircleQuestion,
	Network,
	OctagonAlert,
	Pencil,
	ScanEye,
	ShieldAlert,
	Signal,
	SignalHigh,
	SignalLow,
	SignalMedium,
	SquareTerminal,
	Trash2,
	TrendingUp,
	TriangleAlert,
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
	/** The threads a thread started, as a count. */
	children: defineMark({
		id: "children",
		icon: Network,
		label: "Threads started from it",
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
	/** A provider stop: Limited waits on a clock, Blocked on the user. */
	limit: defineMark({
		id: "limit",
		icon: Clock3,
		icons: { blocked: Ban },
		label: "Usage limit",
		tones: { limited: "warn", blocked: "danger" },
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
} as const satisfies Readonly<Record<string, MarkDef>>;

export type MarkId = keyof typeof MARKS & string;

/** A mark's icon and tone class for one state; an unknown state reads muted with the base icon. */
export function markLook(
	id: MarkId,
	state = "any",
): { icon: LucideIcon; className: string; label: string } {
	const m: MarkDef = MARKS[id];
	return {
		icon: m.icons?.[state] ?? m.icon,
		className: MARK_TONE_CLASS[m.tones[state] ?? "muted"],
		label: m.label,
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
