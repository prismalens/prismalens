// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Copy,
	GitFork,
	MessageSquarePlus,
	MessagesSquare,
	Pencil,
	Quote,
	Type,
	Undo2,
} from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";
import { copyPending } from "@/lib/clipboard";

/** The markdown pipeline loads on the first copy, not at startup (#1125, kernel plan §5). */
const markdown = () => import("@/lib/markdown");

/** A transcript message: its text, and Fork where the response row offers it. */
export interface MessageCtx {
	text: string;
	onFork?: () => void;
	onCopied?: () => void;
	/** Quotes the whole message into the open thread's box or a new thread. */
	quote?: MessageQuote;
	facts: Facts<"forkable" | "quotable">;
}

export interface MessageQuote {
	can: () => boolean;
	run: (to: "box" | "new" | "in") => void;
}

/** The message object: the context its actions run with and the states they test. */
export const messageObject = defineObject<MessageCtx, "forkable" | "quotable">(
	"message",
);

/** The markdown as `text/plain` and the rendered message as `text/html` (#1101). */
export const messageCopy = defineAction({
	id: "message.copy",
	keys: { combo: "Y", label: "Copy the focused message", group: "Thread" },
	label: "Copy",
	icon: Copy,
	run: (c) =>
		void copyPending(
			Promise.resolve(c.text),
			markdown().then((m) => m.markdownToHtml(c.text)),
		).then((ok) => ok && c.onCopied?.()),
});

/** The rendered words alone, with no markdown marks. */
export const messageCopyText = defineAction({
	id: "message.copyText",
	keys: {
		combo: "Shift+Y",
		label: "Copy the focused message as text",
		group: "Thread",
	},
	label: "Copy as text",
	icon: Type,
	run: (c) =>
		void copyPending(markdown().then((m) => m.markdownToText(c.text))).then(
			(ok) => ok && c.onCopied?.(),
		),
});

/** Into this thread's box as a quote chip, as Quote does on a selection. */
export const messageQuote = defineAction({
	id: "message.quote",
	label: "Quote in reply",
	icon: Quote,
	when: (f) => !!f.is?.quotable,
	run: (c) => c.quote?.run("box"),
});

export const messageAskNew = defineAction({
	id: "message.askNew",
	label: "Ask in a new thread",
	icon: MessageSquarePlus,
	when: (f) => !!f.is?.quotable,
	run: (c) => c.quote?.run("new"),
});

/** Into any thread's box, picked from a list (#1195). */
export const messageQuoteIn = defineAction({
	id: "message.quoteIn",
	label: "Quote in another thread",
	icon: MessagesSquare,
	when: (f) => !!f.is?.quotable,
	run: (c) => c.quote?.run("in"),
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
	quote?: MessageQuote,
): MessageCtx {
	return {
		text,
		onFork,
		onCopied,
		quote,
		// Read when a menu opens: the thread's box registers after the first render.
		facts: {
			get is() {
				return { forkable: !!onFork, quotable: !!text && !!quote?.can() };
			},
		},
	};
}

/** A queued message: editable and withdrawable once the API has given it an id. */
export interface QueuedCtx {
	edit: () => void;
	withdraw: () => void;
	facts: Facts<"claimable" | "pending">;
}

/** The queued object: the context its actions run with and the states they test. */
export const queuedObject = defineObject<QueuedCtx, "claimable" | "pending">(
	"queued",
);

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
