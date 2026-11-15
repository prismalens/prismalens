// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect, useRef } from "react";
import type { MessageQuote } from "@/components/investigation/message.actions";
import { type QuoteChip, quoteOf } from "./quote";
import type { SelectionCtx } from "./selection.actions";

/** Where a quote goes: the open thread's box, a new thread, or an aside. */
export interface QuoteTarget {
	threadId: string;
	quote: (q: QuoteChip) => void;
	newThread: (q: QuoteChip) => void;
	aside?: (q: QuoteChip) => void;
}

let current: QuoteTarget | null = null;

/** The open thread's quote handlers, for a message's or a selection's menu (#1101 cross-cutting right-click). */
export const quoteTarget = (): QuoteTarget | null => current;

/** Registers the page's quote handlers while it is mounted; the latest wins. */
export function useQuoteTarget(target: QuoteTarget | null) {
	const latest = useRef(target);
	latest.current = target;
	const id = target?.threadId;
	useEffect(() => {
		if (!id) return;
		const mine: QuoteTarget = {
			threadId: id,
			quote: (q) => latest.current?.quote(q),
			newThread: (q) => latest.current?.newThread(q),
			aside: (q) => latest.current?.aside?.(q),
		};
		current = mine;
		return () => {
			if (current === mine) current = null;
		};
	}, [id]);
}

/** A whole message, quoted into the open thread's box or a new thread. */
export function messageQuote(text: string): MessageQuote {
	return {
		can: () => !!current,
		run: (to) => {
			const t = current;
			const chip =
				t && quoteOf(text, { threadId: t.threadId, kind: "transcript" });
			if (t && chip) (to === "box" ? t.quote : t.newThread)(chip);
		},
	};
}

export function selectionCtx(chip: QuoteChip, done: () => void): SelectionCtx {
	return {
		chip,
		done,
		to: current,
		facts: { is: { aside: !!current?.aside } },
	};
}
