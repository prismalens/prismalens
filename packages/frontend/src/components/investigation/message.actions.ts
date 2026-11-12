// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Copy, GitFork, Pencil, Undo2 } from "lucide-react";
import { defineAction, type Facts } from "@/components/kit/actions";
import { copyText } from "@/lib/clipboard";

/** A transcript message: its text, and Fork where the response row offers it. */
export interface MessageCtx {
	text: string;
	onFork?: () => void;
	onCopied?: () => void;
	facts: Facts<"forkable">;
}

declare module "@/components/kit/actions" {
	interface ObjectContexts {
		message: MessageCtx;
	}
	interface ObjectStates {
		message: "forkable";
	}
	interface ActionObjects {
		"message.copy": "message";
		"message.fork": "message";
	}
}

export const messageCopy = defineAction({
	id: "message.copy",
	label: "Copy",
	icon: Copy,
	run: (c) => void copyText(c.text).then((ok) => ok && c.onCopied?.()),
});

export const messageFork = defineAction({
	id: "message.fork",
	label: "Fork from here",
	icon: GitFork,
	when: (f) => !!f.is?.forkable,
	run: (c) => c.onFork?.(),
});

/** A message's context, with `forkable` set exactly when a fork handler is given. */
export function messageCtx(
	text: string,
	onFork?: () => void,
	onCopied?: () => void,
): MessageCtx {
	return { text, onFork, onCopied, facts: { is: { forkable: !!onFork } } };
}

/** A queued message: editable and withdrawable once the API has given it an id. */
export interface QueuedCtx {
	edit: () => void;
	withdraw: () => void;
	facts: Facts<"claimable" | "pending">;
}

declare module "@/components/kit/actions" {
	interface ObjectContexts {
		queued: QueuedCtx;
	}
	interface ObjectStates {
		queued: "claimable" | "pending";
	}
	interface ActionObjects {
		"queued.edit": "queued";
		"queued.withdraw": "queued";
	}
}

const queuedWait = (f: Facts<"claimable" | "pending">) =>
	!f.is?.claimable ? "Not saved yet" : f.is?.pending ? "Working on it" : false;

export const queuedEdit = defineAction({
	id: "queued.edit",
	label: "Edit",
	icon: Pencil,
	disabled: queuedWait,
	run: (c) => c.edit(),
});

export const queuedWithdraw = defineAction({
	id: "queued.withdraw",
	label: "Withdraw",
	icon: Undo2,
	destructive: true,
	disabled: queuedWait,
	run: (c) => c.withdraw(),
});

/** A queued message's context: `claimable` once it has a server id, `pending` while a change is in flight. */
export function queuedCtx(
	claimable: boolean,
	pending: boolean,
	edit: () => void,
	withdraw: () => void,
): QueuedCtx {
	return { edit, withdraw, facts: { is: { claimable, pending } } };
}
