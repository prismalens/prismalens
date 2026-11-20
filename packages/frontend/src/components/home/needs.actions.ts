// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	CreditCard,
	Gauge,
	HardDrive,
	KeyRound,
	LogIn,
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
import { copyText } from "@/lib/clipboard";

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
	/** That page's name, "Open Anthropic limits": PrismaLens can't change the cap itself. */
	accountLabel: string;
	/** Settings, Runs, where workspaces are listed by size and removed. */
	freeSpace: () => void;
	/** The agent's own sign-in command, e.g. `opencode auth login`. */
	signInCommand: string | null;
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
	| "signIn"
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
	label: (c) => c.accountLabel,
	icon: CreditCard,
	when: (f) => !!f.is?.credit,
	run: (c) => c.account(),
});

export const needsRaiseCap = defineAction({
	id: "needs.raiseCap",
	label: (c) => c.accountLabel,
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

export const needsSignIn = defineAction({
	id: "needs.signIn",
	// Names the command, so the card says what to run in a terminal before Retry.
	label: (c) => `Copy ${c.signInCommand ?? "sign-in command"}`,
	icon: LogIn,
	when: (f) => !!f.is?.signIn,
	run: (c) => void (c.signInCommand && copyText(c.signInCommand)),
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
