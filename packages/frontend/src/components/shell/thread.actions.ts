// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Archive,
	ArchiveRestore,
	BellOff,
	BellRing,
	CalendarClock,
	Check,
	Copy,
	FileCode2,
	FolderGit2,
	FolderTree,
	GitFork,
	GitPullRequest,
	Globe,
	Link2,
	type LucideIcon,
	MessageCircleQuestion,
	PanelRight,
	PanelTop,
	Pencil,
	Pin,
	PinOff,
	RefreshCw,
	SquareArrowOutUpRight,
} from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";

/** A thread, from a sidebar row, its page header or a palette result. */
export interface ThreadCtx {
	rename: () => void;
	nameAgain: () => void;
	togglePin: () => void;
	toggleArchive: () => void;
	settle: () => void;
	open: () => void;
	openWithPanel: () => void;
	copyTranscript: () => void;
	copyLink: () => void;
	/** A phone header's own controls, folded into its ⋯ (#1101 category 5). */
	page?: ThreadPageControls;
	/** Fork here: New thread opens as this thread's child. */
	fork: () => void;
	/** Side question: the thread's composer starts `/btw `. */
	aside: () => void;
	facts: Facts<ThreadState>;
}

export interface ThreadPageControls {
	prLabel: string;
	openPr: () => void;
	details: () => void;
	openPane: (id: "changes" | "files" | "browser" | "kind") => void;
	kindLabel: string;
	kindIcon: LucideIcon;
	toggleStatusBox: () => void;
	notify: () => void;
	mute: () => void;
	schedule: () => void;
}

/** `live`: a run is going; `standalone`: neither an incident's nor a schedule's thread. */
export type ThreadState =
	| "pinned"
	| "archived"
	| "live"
	| "settleable"
	| "standalone"
	/** A title is being made now. */
	| "naming"
	/** A project's thread: its fork works in a fresh worktree. */
	| "project"
	| PageState;

/** A phone header's facts: which folded controls apply, and which are on. */
export type PageState =
	| "phone"
	| "ready"
	| "hasPr"
	| "boxOpen"
	| "running"
	| "watching"
	| "muted"
	| "canSchedule"
	| "paneChanges"
	| "paneFiles"
	| "paneBrowser"
	| "paneKind";

/** The thread object: the context its actions run with and the states they test. */
export const threadObject = defineObject<ThreadCtx, ThreadState>("thread");

const STOP_FIRST = "Stop the run first";
const pinned = (c: ThreadCtx) => !!c.facts.is?.pinned;
const archived = (c: ThreadCtx) => !!c.facts.is?.archived;

export const threadOpen = defineAction({
	id: "thread.open",
	label: "Open",
	icon: SquareArrowOutUpRight,
	run: (c) => c.open(),
});

export const threadPanel = defineAction({
	id: "thread.panel",
	label: "Open with its panel",
	icon: PanelRight,
	when: (f) => !!f.is?.standalone,
	run: (c) => c.openWithPanel(),
});

export const threadRename = defineAction({
	id: "thread.rename",
	keys: { combo: "F2", label: "Rename the focused thread", group: "Thread" },
	label: "Rename",
	icon: Pencil,
	run: (c) => c.rename(),
});

export const threadNameAgain = defineAction({
	id: "thread.nameAgain",
	label: "Name it again",
	icon: RefreshCw,
	disabled: (f) => !!f.is?.naming,
	run: (c) => c.nameAgain(),
});

export const threadPin = defineAction({
	id: "thread.pin",
	keys: {
		combo: "Alt+Shift+P",
		label: "Pin or unpin the focused thread",
		group: "Thread",
	},
	label: (c: ThreadCtx) => (pinned(c) ? "Unpin" : "Pin"),
	icon: (c: ThreadCtx) => (pinned(c) ? PinOff : Pin),
	run: (c) => c.togglePin(),
});

export const threadArchive = defineAction({
	id: "thread.archive",
	keys: {
		combo: "Alt+Shift+A",
		label: "Archive the focused thread",
		group: "Thread",
	},
	label: (c: ThreadCtx) => (archived(c) ? "Unarchive" : "Archive"),
	icon: (c: ThreadCtx) => (archived(c) ? ArchiveRestore : Archive),
	disabled: (f) => (f.is?.live && !f.is?.archived ? STOP_FIRST : false),
	run: (c) => c.toggleArchive(),
});

export const threadTranscript = defineAction({
	id: "thread.transcript",
	keys: {
		combo: "T",
		label: "Copy the focused thread's transcript",
		group: "Thread",
	},
	label: "Copy transcript",
	icon: Copy,
	run: (c) => c.copyTranscript(),
});

export const threadLink = defineAction({
	id: "thread.link",
	keys: {
		combo: "L",
		label: "Copy the focused thread's link",
		group: "Thread",
	},
	label: "Copy link",
	icon: Link2,
	run: (c) => c.copyLink(),
});

export const threadSettle = defineAction({
	id: "thread.settle",
	keys: { combo: "S", label: "Settle the focused thread", group: "Thread" },
	label: "Settle",
	icon: Check,
	when: (f) => !!f.is?.settleable,
	run: (c) => c.settle(),
});

// The phone header's own controls; a wider header keeps them as buttons.
const NOT_READY = "Still loading";
const NOT_RUNNING = "Not running";
const phone = (f: Facts<ThreadState>) => !!f.is?.phone;
const notReady = (f: Facts<ThreadState>) => (f.is?.ready ? false : NOT_READY);

export const threadPr = defineAction({
	id: "thread.pr",
	label: (c: ThreadCtx) => c.page?.prLabel ?? "Pull request",
	icon: GitPullRequest,
	when: (f) => phone(f) && !!f.is?.hasPr,
	run: (c) => c.page?.openPr(),
});

export const threadDetails = defineAction({
	id: "thread.details",
	label: "Details",
	icon: PanelRight,
	when: phone,
	disabled: notReady,
	run: (c) => c.page?.details(),
});

export const threadChanges = defineAction({
	id: "thread.changes",
	label: "Changes",
	icon: FileCode2,
	when: (f) => phone(f) && !!f.is?.paneChanges,
	disabled: notReady,
	run: (c) => c.page?.openPane("changes"),
});

export const threadFiles = defineAction({
	id: "thread.files",
	label: "Files",
	icon: FolderTree,
	when: (f) => phone(f) && !!f.is?.paneFiles,
	disabled: notReady,
	run: (c) => c.page?.openPane("files"),
});

export const threadBrowser = defineAction({
	id: "thread.browser",
	label: "Browser",
	icon: Globe,
	when: (f) => phone(f) && !!f.is?.paneBrowser,
	disabled: notReady,
	run: (c) => c.page?.openPane("browser"),
});

export const threadKind = defineAction({
	id: "thread.kind",
	label: (c: ThreadCtx) => c.page?.kindLabel ?? "Subject",
	icon: (c: ThreadCtx) => c.page?.kindIcon ?? PanelRight,
	when: (f) => phone(f) && !!f.is?.paneKind,
	disabled: notReady,
	run: (c) => c.page?.openPane("kind"),
});

export const threadStatusBox = defineAction({
	id: "thread.statusBox",
	label: "Status",
	icon: PanelTop,
	when: phone,
	disabled: notReady,
	checked: (c) => !!c.facts.is?.boxOpen,
	run: (c) => c.page?.toggleStatusBox(),
});

export const threadNotify = defineAction({
	id: "thread.notify",
	label: "Notify when finished",
	icon: BellRing,
	when: phone,
	disabled: (f) => (f.is?.running || f.is?.watching ? false : NOT_RUNNING),
	checked: (c) => !!c.facts.is?.watching,
	run: (c) => c.page?.notify(),
});

export const threadMute = defineAction({
	id: "thread.mute",
	label: "Mute",
	icon: BellOff,
	when: phone,
	checked: (c) => !!c.facts.is?.muted,
	run: (c) => c.page?.mute(),
});

export const threadSchedule = defineAction({
	id: "thread.schedule",
	label: "Add scheduled task",
	icon: CalendarClock,
	// Every width: a rare action, so it lives in ⋯ and never as a header button.
	when: (f) => !!f.is?.canSchedule,
	run: (c) => c.page?.schedule(),
});

// A fork is a child in the tree; incident and scheduled threads fork from their own page.
const NOT_HERE = "Not on incident threads";
const forkOff = (f: Facts<ThreadState>) =>
	f.is?.standalone ? false : NOT_HERE;

export const threadFork = defineAction({
	id: "thread.fork",
	keys: { combo: "F", label: "Fork the focused thread here", group: "Thread" },
	label: "Fork here",
	icon: GitFork,
	disabled: forkOff,
	run: (c) => c.fork(),
});

export const threadAside = defineAction({
	id: "thread.aside",
	keys: {
		combo: "B",
		label: "Ask a side question on the focused thread",
		group: "Thread",
	},
	label: "Side question",
	icon: MessageCircleQuestion,
	disabled: forkOff,
	run: (c) => c.aside(),
});

// A child never borrows the checkout (#1024), so a fork is how a thread moves to a worktree.
export const threadWorktree = defineAction({
	id: "thread.worktree",
	keys: {
		combo: "W",
		label: "Fork the focused thread into a worktree",
		group: "Thread",
	},
	label: "Fork into a worktree",
	icon: FolderGit2,
	when: (f) => !!f.is?.project,
	disabled: forkOff,
	run: (c) => c.fork(),
});
