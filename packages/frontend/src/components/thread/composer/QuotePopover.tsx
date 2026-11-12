// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	MessageCircleQuestion,
	MessageSquarePlus,
	Quote as QuoteIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { type QuoteChip, quoteOf, selectionSource } from "./quote";

interface Selected {
	chip: QuoteChip;
	top: number;
	left: number;
}

function readSelection(threadId: string): Selected | null {
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
	const kind = selectionSource(sel.anchorNode);
	if (!kind || selectionSource(sel.focusNode) === null) return null;
	const chip = quoteOf(sel.toString(), { threadId, kind });
	if (!chip) return null;
	const rect = sel.getRangeAt(0).getBoundingClientRect();
	return {
		chip,
		top: Math.max(8, rect.top - 40),
		left: Math.min(window.innerWidth - 260, Math.max(8, rect.left)),
	};
}

/**
 * The two actions over a selection in the transcript, report or a tool's output
 * (#1024): Quote puts a chip in the box, Ask in a new thread opens New thread with it.
 * Ctrl/Cmd+L quotes too.
 */
export function QuotePopover({
	threadId,
	onQuote,
	onNewThread,
	onAside,
}: {
	threadId: string;
	onQuote: (q: QuoteChip) => void;
	onNewThread: (q: QuoteChip) => void;
	/** Ask about the selection beside the thread, never into it (sheet §2). */
	onAside?: (q: QuoteChip) => void;
}) {
	const [sel, setSel] = useState<Selected | null>(null);
	useEffect(() => {
		let frame = 0;
		const update = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => setSel(readSelection(threadId)));
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key.toLowerCase() !== "l" || !(e.ctrlKey || e.metaKey)) return;
			const now = readSelection(threadId);
			if (!now) return;
			e.preventDefault();
			onQuote(now.chip);
			window.getSelection()?.removeAllRanges();
		};
		document.addEventListener("selectionchange", update);
		document.addEventListener("keydown", onKey);
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener("selectionchange", update);
			document.removeEventListener("keydown", onKey);
		};
	}, [threadId, onQuote]);
	if (!sel) return null;
	const done = () => {
		window.getSelection()?.removeAllRanges();
		setSel(null);
	};
	return createPortal(
		<div
			role="toolbar"
			aria-label="Selection"
			style={{ top: sel.top, left: sel.left }}
			className="fixed z-50 flex items-center gap-0.5 rounded-control bg-surface-3 p-0.5 shadow-float"
			data-testid="quote-popover"
			onMouseDown={(e) => e.preventDefault()}
		>
			<Button
				variant="ghost"
				size="sm"
				onClick={() => {
					onQuote(sel.chip);
					done();
				}}
				data-testid="quote-popover-quote"
			>
				<QuoteIcon />
				Quote
			</Button>
			<Button
				variant="ghost"
				size="sm"
				onClick={() => {
					onNewThread(sel.chip);
					done();
				}}
				data-testid="quote-popover-new-thread"
			>
				<MessageSquarePlus />
				Ask in a new thread
			</Button>
			{onAside && (
				<Button
					variant="ghost"
					size="sm"
					onClick={() => {
						onAside(sel.chip);
						done();
					}}
					data-testid="quote-popover-aside"
				>
					<MessageCircleQuestion />
					Ask aside
				</Button>
			)}
		</div>,
		document.body,
	);
}
