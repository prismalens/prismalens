// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ChevronsDownUp,
	ChevronsUpDown,
	Link2,
	PanelRight,
	RefreshCw,
	Reply,
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
	/** Drafts a fix for its failing checks in the composer; you still press Send. */
	draftFix: () => void;
	facts: Facts<"hasUrl" | "refreshable" | "failing">;
}

/** One check or pipeline job in the change-request view. */
export interface CheckCtx {
	url: string;
	toggleLog: () => void;
	draftFix: () => void;
	facts: Facts<"hasUrl" | "failing" | "running" | "hasLog" | "logOpen">;
}

/** One review thread in the change-request view: a person replies; the agent is asked to fix. */
export interface ReviewCtx {
	url: string;
	reply: () => void;
	draftFix: () => void;
	facts: Facts<"hasUrl" | "open">;
}

export const reviewObject = defineObject<ReviewCtx, "hasUrl" | "open">(
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

export const reviewDraftFix = defineAction({
	id: "review.draftFix",
	label: "Ask the agent to fix",
	icon: Wrench,
	when: (f) => !!f.is?.open,
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
	"hasUrl" | "refreshable" | "failing"
>("pr");

/** The check object: the context its actions run with and the states they test. */
export const checkObject = defineObject<
	CheckCtx,
	"hasUrl" | "failing" | "running" | "hasLog" | "logOpen"
>("check");

export const prOpenPanel = defineAction({
	id: "pr.openPanel",
	label: "Open in the panel",
	icon: PanelRight,
	run: (c) => c.openPanel(),
});

export const prDraftFix = defineAction({
	id: "pr.draftFix",
	label: "Ask the agent to fix",
	icon: Wrench,
	when: (f) => !!f.is?.failing,
	run: (c) => c.draftFix(),
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
export const checkDraftFix = defineAction({
	id: "check.draftFix",
	label: "Ask the agent to fix",
	icon: Wrench,
	disabled: (f) =>
		f.is?.failing ? false : f.is?.running ? "Running" : "Passed",
	run: (c) => c.draftFix(),
});

export const checkOpenLog = defineAction({
	id: "check.openLog",
	label: "Open log on the host",
	icon: SquareArrowOutUpRight,
	when: (f) => !!f.is?.hasUrl,
	run: (c) => void window.open(c.url, "_blank", "noreferrer"),
});
