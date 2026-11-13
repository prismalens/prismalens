// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	CreditCard,
	Gauge,
	KeyRound,
	MessageSquareReply,
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
	retryNow: () => void;
	open: () => void;
	facts: Facts<NeedsState>;
}

/** `ask`: an ask waits here; `account`: the provider has a known billing page. */
export type NeedsState = "ask" | "account" | "busy";

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
	run: (c) => c.updateKey(),
});

export const needsAddCredit = defineAction({
	id: "needs.addCredit",
	label: "Add credit",
	icon: CreditCard,
	when: (f) => !!f.is?.account,
	run: (c) => c.account(),
});

export const needsRaiseCap = defineAction({
	id: "needs.raiseCap",
	label: "Raise the cap",
	icon: Gauge,
	when: (f) => !!f.is?.account,
	run: (c) => c.account(),
});

export const needsRetryNow = defineAction({
	id: "needs.retryNow",
	label: "Retry now",
	icon: RotateCw,
	disabled: (f) => !!f.is?.busy,
	run: (c) => c.retryNow(),
});

export const needsOpen = defineAction({
	id: "needs.open",
	label: "Open",
	icon: SquareArrowOutUpRight,
	run: (c) => c.open(),
});
