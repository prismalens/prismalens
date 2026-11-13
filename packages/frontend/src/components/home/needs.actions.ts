// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	CreditCard,
	Gauge,
	HardDrive,
	KeyRound,
	MessageSquareReply,
	Play,
	RotateCw,
	SquareArrowOutUpRight,
} from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";

/**
 * A thread that needs you, on a Home card or in the list: each status names its
 * one fix by id (`fix` in kit `STATUS_DEFS`), so every surface offers the same one.
 */
export interface NeedsCtx {
	/** Opens the ask beside the card, answerable in place. */
	answer: () => void;
	/** Settings, Agent, at the thread's agent. */
	updateKey: () => void;
	/** The provider's billing or limits page. */
	account: () => void;
	/** Settings, Runs, where kept run workspaces are removed. */
	freeSpace: () => void;
	retryNow: () => void;
	/** Picks up a run PrismaLens's restart cut off. */
	resume: () => void;
	open: () => void;
	facts: Facts<NeedsState>;
}

/**
 * `ask`: an ask waits here; `key`, `credit`, `cap`: the stop cause's registered fix (`stopCause`),
 * the last two only with a known account page; `disk`: no disk left; `interrupted`: a restart cut it off.
 */
export type NeedsState =
	| "ask"
	| "key"
	| "credit"
	| "cap"
	| "busy"
	| "disk"
	| "interrupted";

/** The needs object: the context its actions run with and the states they test. */
export const needsObject = defineObject<NeedsCtx, NeedsState>("needs");

export const needsAnswer = defineAction({
	id: "needs.answer",
	label: "Answer",
	icon: MessageSquareReply,
	when: (f) => !!f.is?.ask,
	run: (c) => c.answer(),
});

export const needsUpdateKey = defineAction({
	id: "needs.updateKey",
	label: "Update key",
	icon: KeyRound,
	when: (f) => !!f.is?.key,
	run: (c) => c.updateKey(),
});

export const needsAddCredit = defineAction({
	id: "needs.addCredit",
	label: "Add credit",
	icon: CreditCard,
	when: (f) => !!f.is?.credit,
	run: (c) => c.account(),
});

export const needsRaiseCap = defineAction({
	id: "needs.raiseCap",
	label: "Raise the cap",
	icon: Gauge,
	when: (f) => !!f.is?.cap,
	run: (c) => c.account(),
});

export const needsFreeSpace = defineAction({
	id: "needs.freeSpace",
	label: "Free space",
	icon: HardDrive,
	when: (f) => !!f.is?.disk,
	run: (c) => c.freeSpace(),
});

export const needsRetryNow = defineAction({
	id: "needs.retryNow",
	label: "Retry now",
	icon: RotateCw,
	disabled: (f) => !!f.is?.busy,
	run: (c) => c.retryNow(),
});

export const needsResume = defineAction({
	id: "needs.resume",
	label: "Resume",
	icon: Play,
	when: (f) => !!f.is?.interrupted,
	disabled: (f) => !!f.is?.busy,
	run: (c) => c.resume(),
});

export const needsOpen = defineAction({
	id: "needs.open",
	label: "Open",
	icon: SquareArrowOutUpRight,
	run: (c) => c.open(),
});
