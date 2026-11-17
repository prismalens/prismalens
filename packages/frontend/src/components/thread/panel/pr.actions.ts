// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ChevronsDownUp,
	ChevronsUpDown,
	Link2,
	MessageSquareText,
	PanelRight,
	RefreshCw,
	Reply,
	RotateCw,
	ScrollText,
	SquareArrowOutUpRight,
	Wrench,
} from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

/** The thread's change request in its header chip. */
export interface PrCtx {
	url: string;
	openPanel: () => void;
	refresh: () => void;
	/** Drafts a fix for its failing checks in this thread's composer; you still press Send. */
	draftFix: () => void;
	/** Opens its failing checks, where a new thread can fix them. */
	fixChecks: () => void;
	/** Opens its open review comments, where a new thread can address them. */
	fixComments: () => void;
	facts: Facts<"hasUrl" | "refreshable" | "failing" | "own" | "comments">;
}

/** One check or pipeline job in the change-request view. */
export interface CheckCtx {
	url: string;
	toggleLog: () => void;
	/** Shows the whole log in the panel. */
	showFull: () => void;
	draftFix: () => void;
	/** Previews a new thread that fixes it (#1176). */
	fixThread: () => void;
	/** Asks to re-run it on the host, behind a confirm. */
	rerun: () => void;
	facts: Facts<CheckFact>;
}

type CheckFact =
	| "hasUrl"
	| "failing"
	| "running"
	| "hasLog"
	| "logOpen"
	| "canFull"
	| "fixable"
	| "own"
	| "rerunnable"
	| "rerunWait"
	| "rerunOff";

/** One review thread in the change-request view: a person replies; the agent is asked to fix. */
export interface ReviewCtx {
	url: string;
	reply: () => void;
	draftFix: () => void;
	fixThread: () => void;
	facts: Facts<"hasUrl" | "open" | "own">;
}

export const reviewObject = defineObject<ReviewCtx, "hasUrl" | "open" | "own">(
	"review",
);

/** Opens and focuses the thread's Reply box; the post itself is the box's button. */
export const reviewReply = defineAction({
	id: "review.reply",
	label: "Reply",
	icon: Reply,
	when: (f) => !!f.is?.open,
	run: (c) => c.reply(),
});

export const reviewFixThread = defineAction({
	id: "review.fixThread",
	label: "Fix in a new thread",
	icon: Wrench,
	when: (f) => !!f.is?.open,
	run: (c) => c.fixThread(),
});

/** Only a thread on the PR's branch can push the fix it is asked for (#1176 D5). */
export const reviewDraftFix = defineAction({
	id: "review.draftFix",
	label: "Ask this thread",
	icon: MessageSquareText,
	when: (f) => !!f.is?.open && !!f.is?.own,
	run: (c) => c.draftFix(),
});

export const reviewOpenHost = defineAction({
	id: "review.openHost",
	label: "Reply on the host",
	icon: SquareArrowOutUpRight,
	when: (f) => !!f.is?.hasUrl,
	run: (c) => void window.open(c.url, "_blank", "noreferrer"),
});

/** The pr object: the context its actions run with and the states they test. */
export const prObject = defineObject<
	PrCtx,
	"hasUrl" | "refreshable" | "failing" | "own" | "comments"
>("pr");

/** The check object: the context its actions run with and the states they test. */
export const checkObject = defineObject<CheckCtx, CheckFact>("check");

export const prOpenPanel = defineAction({
	id: "pr.openPanel",
	label: "Open in the panel",
	icon: PanelRight,
	run: (c) => c.openPanel(),
});

export const prDraftFix = defineAction({
	id: "pr.draftFix",
	label: "Ask this thread",
	icon: MessageSquareText,
	when: (f) => !!f.is?.failing && !!f.is?.own,
	run: (c) => c.draftFix(),
});

export const prFixChecks = defineAction({
	id: "pr.fixChecks",
	label: "Fix checks in a new thread",
	icon: Wrench,
	when: (f) => !!f.is?.failing,
	run: (c) => c.fixChecks(),
});

export const prFixComments = defineAction({
	id: "pr.fixComments",
	label: "Fix comments in a new thread",
	icon: Wrench,
	when: (f) => !!f.is?.comments,
	run: (c) => c.fixComments(),
});

export const prOpenHost = defineAction({
	id: "pr.openHost",
	label: "Open on the host",
	icon: SquareArrowOutUpRight,
	when: (f) => !!f.is?.hasUrl,
	run: (c) => void window.open(c.url, "_blank", "noreferrer"),
});

export const prCopyLink = defineAction({
	id: "pr.copyLink",
	label: "Copy link",
	icon: Link2,
	when: (f) => !!f.is?.hasUrl,
	run: (c) => void copyText(c.url),
});

export const prRefresh = defineAction({
	id: "pr.refresh",
	label: "Refresh",
	icon: RefreshCw,
	when: (f) => !!f.is?.refreshable,
	run: (c) => c.refresh(),
});

export const checkToggleLog = defineAction({
	id: "check.toggleLog",
	label: (c: CheckCtx) => (c.facts.is?.logOpen ? "Hide the log" : "Open log"),
	icon: (c: CheckCtx) =>
		c.facts.is?.logOpen ? ChevronsDownUp : ChevronsUpDown,
	when: (f) => !!f.is?.hasLog,
	run: (c) => c.toggleLog(),
});

/** Listed on every check, so the menu reads the same; only a failing one has something to fix. */
export const checkFixThread = defineAction({
	id: "check.fixThread",
	label: "Fix in a new thread",
	icon: Wrench,
	disabled: (f) =>
		f.is?.fixable
			? false
			: f.is?.failing
				? "Cancelled"
				: f.is?.running
					? "Running"
					: "Passed",
	run: (c) => c.fixThread(),
});

/** Only a thread on the PR's branch can push the fix it is asked for (#1176 D5). */
export const checkDraftFix = defineAction({
	id: "check.draftFix",
	label: "Ask this thread",
	icon: MessageSquareText,
	when: (f) => !!f.is?.failing && !!f.is?.own,
	run: (c) => c.draftFix(),
});

export const checkRerun = defineAction({
	id: "check.rerun",
	label: "Re-run",
	icon: RotateCw,
	when: (f) => !!f.is?.failing,
	disabled: (f) =>
		f.is?.rerunWait
			? "Its workflow is still running"
			: !f.is?.rerunnable
				? "Can't re-run this one"
				: f.is?.rerunOff
					? "Re-run is off"
					: false,
	run: (c) => c.rerun(),
});

/** The whole log in the panel, so reading CI never sends the person to the host (#1101 parity). */
export const checkFullLog = defineAction({
	id: "check.fullLog",
	label: "Show the full log",
	icon: ScrollText,
	when: (f) => !!f.is?.canFull,
	run: (c) => c.showFull(),
});

export const checkOpenLog = defineAction({
	id: "check.openLog",
	label: "Open on the host",
	icon: SquareArrowOutUpRight,
	when: (f) => !!f.is?.hasUrl,
	run: (c) => void window.open(c.url, "_blank", "noreferrer"),
});
