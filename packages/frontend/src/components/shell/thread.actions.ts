// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Archive,
	ArchiveRestore,
	Check,
	Copy,
	Link2,
	PanelRight,
	Pencil,
	Pin,
	PinOff,
	RefreshCw,
	SquareArrowOutUpRight,
} from "lucide-react";
import { defineAction, type Facts } from "@/components/kit/actions";

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
	facts: Facts<ThreadState>;
}

/** `live`: a run is going; `standalone`: neither an incident's nor a schedule's thread. */
export type ThreadState =
	| "pinned"
	| "archived"
	| "live"
	| "settleable"
	| "standalone"
	/** A title is being made now. */
	| "naming";

declare module "@/components/kit/actions" {
	interface ObjectContexts {
		thread: ThreadCtx;
	}
	interface ObjectStates {
		thread: ThreadState;
	}
	interface ActionObjects {
		"thread.open": "thread";
		"thread.panel": "thread";
		"thread.rename": "thread";
		"thread.nameAgain": "thread";
		"thread.pin": "thread";
		"thread.archive": "thread";
		"thread.transcript": "thread";
		"thread.link": "thread";
		"thread.settle": "thread";
	}
}

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
	label: (c: ThreadCtx) => (pinned(c) ? "Unpin" : "Pin"),
	icon: (c: ThreadCtx) => (pinned(c) ? PinOff : Pin),
	run: (c) => c.togglePin(),
});

export const threadArchive = defineAction({
	id: "thread.archive",
	label: (c: ThreadCtx) => (archived(c) ? "Unarchive" : "Archive"),
	icon: (c: ThreadCtx) => (archived(c) ? ArchiveRestore : Archive),
	disabled: (f) => (f.is?.live && !f.is?.archived ? STOP_FIRST : false),
	run: (c) => c.toggleArchive(),
});

export const threadTranscript = defineAction({
	id: "thread.transcript",
	label: "Copy transcript",
	icon: Copy,
	run: (c) => c.copyTranscript(),
});

export const threadLink = defineAction({
	id: "thread.link",
	label: "Copy link",
	icon: Link2,
	run: (c) => c.copyLink(),
});

export const threadSettle = defineAction({
	id: "thread.settle",
	label: "Settle",
	icon: Check,
	when: (f) => !!f.is?.settleable,
	run: (c) => c.settle(),
});
