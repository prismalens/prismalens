// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Copy, GitFork } from "lucide-react";
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
