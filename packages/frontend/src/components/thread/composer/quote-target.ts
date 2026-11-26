// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect, useRef } from "react";
import type { MessageQuote } from "@/components/investigation/message.actions";
import { type QuoteChip, quoteOf } from "./quote";
import type { SelectionCtx } from "./selection.actions";

/** Where a quote goes: the open thread's box, a new thread, an aside, or any thread picked (#1195). */
export interface QuoteTarget {
	threadId: string;
	quote: (q: QuoteChip) => void;
	newThread: (q: QuoteChip) => void;
	aside?: (q: QuoteChip) => void;
	quoteIn?: (q: QuoteChip) => void;
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
			quoteIn: (q) => latest.current?.quoteIn?.(q),
		};
		current = mine;
		return () => {
			if (current === mine) current = null;
		};
	}, [id]);
}

/** A whole message, quoted into the open thread's box, a new thread or any thread; `key` names it (#1195). */
export function messageQuote(text: string, key?: string | null): MessageQuote {
	return {
		can: () => !!current,
		run: (to) => {
			const t = current;
			const seq = key ? Number(key.split(":").pop()) : Number.NaN;
			const chip =
				t &&
				quoteOf(text, {
					threadId: t.threadId,
					kind: "transcript",
					...(key && Number.isInteger(seq) ? { key, seq } : {}),
				});
			if (!t || !chip) return;
			if (to === "box") t.quote(chip);
			else if (to === "new") t.newThread(chip);
			else t.quoteIn?.(chip);
		},
	};
}

export function selectionCtx(chip: QuoteChip, done: () => void): SelectionCtx {
	return {
		chip,
		done,
		to: current,
		facts: { is: { aside: !!current?.aside, quoteIn: !!current?.quoteIn } },
	};
}
