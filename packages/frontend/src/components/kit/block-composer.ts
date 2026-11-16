// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	quoteOf,
	sendQuote,
	sendReference,
} from "@/components/thread/composer/quote";
import { toast } from "@/hooks/use-toast";
import { blockSourceView } from "./block-sources";
import type { BlockSource } from "./blocks";

/** What the user selected inside a block, with the file lines it spans when the block numbers them. */
export interface BlockSelection {
	text: string;
	lines: [number, number] | null;
}

const lineOf = (n: Node | null): number | null => {
	const el = n instanceof Element ? n : (n?.parentElement ?? null);
	const at = el?.closest<HTMLElement>("[data-line]")?.dataset.line;
	const v = Number(at);
	return at && Number.isFinite(v) ? v : null;
};

/** A selection's text and the `data-line` rows it spans. */
function read(sel: Selection | null): BlockSelection | null {
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
	const text = sel.toString();
	if (!text.trim()) return null;
	const a = lineOf(sel.anchorNode);
	const b = lineOf(sel.focusNode);
	return {
		text,
		lines: a && b ? [Math.min(a, b), Math.max(a, b)] : null,
	};
}

/**
 * The selection inside `root`, or null when there is none there. A code viewer
 * draws in an open shadow root, whose selection the document reports only as its host.
 */
export function selectionIn(
	root: HTMLElement | null,
	shadow = false,
): BlockSelection | null {
	if (!root) return null;
	if (shadow)
		for (const host of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
			const inner = (
				host.shadowRoot as
					| (ShadowRoot & { getSelection?: () => Selection | null })
					| null
			)?.getSelection?.();
			if (inner && !inner.isCollapsed) return read(inner);
		}
	const doc = document.getSelection();
	if (doc && root.contains(doc.anchorNode) && root.contains(doc.focusNode))
		return read(doc);
	return null;
}

/**
 * Add to composer (#1101): a selection becomes a quote chip carrying its source
 * (a file's path and lines, the thread item, or the log's name); with no
 * selection a file adds a `path:line` reference chip and anything else quotes
 * the whole block.
 */
export function addToComposer(
	threadId: string,
	source: BlockSource,
	whole: string,
	selected: BlockSelection | null,
	/** The line a right-click named, for a file with no selection. */
	pointed: number | null,
	/** A file's own text for a line span, so the quote never carries a viewer's gutter. */
	linesText?: (start: number, end: number) => string | null,
) {
	const done = (ok: boolean) =>
		toast({
			title: ok ? "Added to your message" : "Open the composer to add",
		});
	const view = blockSourceView(source);
	if (view.reference && !selected) {
		done(sendReference(threadId, view.reference(source, pointed)));
		return;
	}
	const span = selected?.lines ?? null;
	const exact = view.exactLines && span && linesText?.(span[0], span[1]);
	const text = exact || (selected?.text ?? whole);
	const chip = quoteOf(text, view.from(source, threadId, span));
	done(!!chip && sendQuote(threadId, chip));
	if (selected) document.getSelection()?.removeAllRanges();
}
