// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Copy,
	MessageCircleQuestion,
	MessageSquarePlus,
	MessagesSquare,
	Quote,
} from "lucide-react";
import {
	defineAction,
	defineObject,
	type Facts,
} from "@/components/kit/actions";
import { copyPending } from "@/lib/clipboard";
import type { QuoteChip } from "./quote";

/** Text selected in a transcript, a report or a tool's output. */
export interface SelectionCtx {
	chip: QuoteChip;
	/** Clears the selection once an action took it. */
	done: () => void;
	/** The open thread's handlers (`quote-target`). */
	to: {
		quote: (q: QuoteChip) => void;
		newThread: (q: QuoteChip) => void;
		aside?: (q: QuoteChip) => void;
		quoteIn?: (q: QuoteChip) => void;
	} | null;
	facts: Facts<"aside" | "quoteIn">;
}

export const selectionObject = defineObject<SelectionCtx, "aside" | "quoteIn">(
	"selection",
);

export const selectionCopy = defineAction({
	id: "selection.copy",
	label: "Copy",
	icon: Copy,
	run: (c) => void copyPending(Promise.resolve(c.chip.quote.text)),
});

export const selectionQuote = defineAction({
	id: "selection.quote",
	keys: { combo: "Mod+L", label: "Quote the selection", group: "Thread" },
	label: "Quote",
	icon: Quote,
	run: (c) => {
		c.to?.quote(c.chip);
		c.done();
	},
});

export const selectionAskNew = defineAction({
	id: "selection.askNew",
	label: "Ask in a new thread",
	icon: MessageSquarePlus,
	run: (c) => {
		c.to?.newThread(c.chip);
		c.done();
	},
});

/** Ask about the selection beside the thread, never into it (sheet §2). */
export const selectionAside = defineAction({
	id: "selection.aside",
	label: "Ask aside",
	icon: MessageCircleQuestion,
	when: (f) => !!f.is?.aside,
	run: (c) => {
		c.to?.aside?.(c.chip);
		c.done();
	},
});

/** Into any thread's box, picked from a list (#1195). */
export const selectionQuoteIn = defineAction({
	id: "selection.quoteIn",
	label: "Quote in another thread",
	icon: MessagesSquare,
	when: (f) => !!f.is?.quoteIn,
	run: (c) => {
		c.to?.quoteIn?.(c.chip);
		c.done();
	},
});
