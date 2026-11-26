// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { REWIND_BLOCK_WORDS, type RewindBlock } from "@prismalens/contracts";
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

/** What the message menu can tell about Edit before the server's preview (#1193). */
type EditState =
	| "editable"
	| "editRunning"
	| "editQueued"
	| "editReport"
	| "editViewOnly";
type MessageState = "forkable" | "quotable" | EditState;

/** A user's sent message: Edit opens it in place, or why it can't now. */
export interface MessageEdit {
	block: RewindBlock | null;
	run: () => void;
}

/** A transcript message: its text, and Fork where the response row offers it. */
export interface MessageCtx {
	text: string;
	onFork?: () => void;
	onCopied?: () => void;
	/** Quotes the whole message into the open thread's box or a new thread. */
	quote?: MessageQuote;
	/** Set on the user's own sent messages only (#1193). */
	edit?: MessageEdit;
	facts: Facts<MessageState>;
}

export interface MessageQuote {
	can: () => boolean;
	run: (to: "box" | "new" | "in") => void;
}

/** The message object: the context its actions run with and the states they test. */
export const messageObject = defineObject<MessageCtx, MessageState>("message");

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

/** Edit a sent message and run it again (#1193): the turns after it fold, the agent's files go back. */
export const messageEdit = defineAction({
	id: "message.edit",
	label: "Edit",
	icon: Pencil,
	when: (f) => !!f.is?.editable,
	disabled: (f) =>
		f.is?.editViewOnly
			? REWIND_BLOCK_WORDS["view-only"]
			: f.is?.editRunning
				? REWIND_BLOCK_WORDS.running
				: f.is?.editQueued
					? REWIND_BLOCK_WORDS.queued
					: f.is?.editReport
						? REWIND_BLOCK_WORDS["before-report"]
						: false,
	run: (c) => c.edit?.run(),
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
	edit?: MessageEdit,
): MessageCtx {
	return {
		text,
		onFork,
		onCopied,
		quote,
		...(edit ? { edit } : {}),
		// Read when a menu opens: the thread's box registers after the first render.
		facts: {
			get is() {
				const b = edit?.block;
				return {
					forkable: !!onFork,
					quotable: !!text && !!quote?.can(),
					editable: !!edit,
					editRunning: b === "running",
					editQueued: b === "queued",
					editReport: b === "before-report",
					editViewOnly: b === "view-only",
				};
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
