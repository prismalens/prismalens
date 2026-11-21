// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { isMenuKey } from "@/components/kit/Menu";
import { ContextMenuAt } from "@/components/kit/MenuImpl";
import { surfaceEntries } from "@/components/kit/registry";
import { Button } from "@/components/ui/button";
import { listenKeys } from "@/hooks/use-global-shortcuts";
import {
	type QuoteChip,
	quoteOf,
	selectionKey,
	selectionSource,
} from "./quote";
import { selectionCtx } from "./quote-target";

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
	const key = selectionKey(sel.anchorNode);
	const at = key?.split(":").pop();
	const chip = quoteOf(sel.toString(), {
		threadId,
		kind,
		...(key && at ? { key, seq: Number(at) } : {}),
	});
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
}: {
	threadId: string;
	onQuote: (q: QuoteChip) => void;
}) {
	const [sel, setSel] = useState<Selected | null>(null);
	const [menu, setMenu] = useState<{
		chip: QuoteChip;
		at: { x: number; y: number };
	} | null>(null);
	// Right-click, Shift+F10 and the Menu key on a selection open its rows (#1101 cross-cutting).
	useEffect(() => {
		const onMenu = (e: MouseEvent) => {
			const now = readSelection(threadId);
			const range = window.getSelection()?.getRangeAt(0);
			if (!now || !range || !(e.target instanceof Node)) return;
			if (!range.intersectsNode(e.target)) return;
			e.preventDefault();
			setMenu({ chip: now.chip, at: { x: e.clientX, y: e.clientY } });
		};
		const onKey = (e: KeyboardEvent) => {
			if (!isMenuKey(e)) return;
			const now = readSelection(threadId);
			if (!now) return;
			e.preventDefault();
			e.stopPropagation();
			setMenu({ chip: now.chip, at: { x: now.left, y: now.top + 40 } });
		};
		document.addEventListener("contextmenu", onMenu);
		const offKey = listenKeys(onKey, { target: document, capture: true });
		return () => {
			document.removeEventListener("contextmenu", onMenu);
			offKey();
		};
	}, [threadId]);
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
		const offKey = listenKeys(onKey, { target: document });
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener("selectionchange", update);
			offKey();
		};
	}, [threadId, onQuote]);
	const done = () => {
		window.getSelection()?.removeAllRanges();
		setSel(null);
	};
	if (menu)
		return (
			<ContextMenuAt
				at={menu.at}
				label="Selection actions"
				entries={() =>
					surfaceEntries("selection", "context", selectionCtx(menu.chip, done))
				}
				onClose={() => setMenu(null)}
			/>
		);
	if (!sel) return null;
	const entries = surfaceEntries(
		"selection",
		"more",
		selectionCtx(sel.chip, done),
	);
	return createPortal(
		<div
			role="toolbar"
			aria-label="Selection"
			style={{ top: sel.top, left: sel.left }}
			className="fixed z-50 flex items-center gap-0.5 rounded-control bg-surface-3 p-0.5 shadow-float"
			data-testid="quote-popover"
			onMouseDown={(e) => e.preventDefault()}
		>
			{entries.map((e) =>
				"separator" in e ? null : (
					<Button
						key={e.id}
						variant="ghost"
						size="sm"
						disabled={!!e.disabled}
						onClick={e.onSelect}
						data-testid={TEST_IDS[e.id] ?? `quote-popover-${e.id}`}
					>
						{e.icon && <e.icon />}
						{e.label}
					</Button>
				),
			)}
		</div>,
		document.body,
	);
}

/** The bar's test ids from before it read the registry. */
const TEST_IDS: Record<string, string> = {
	quote: "quote-popover-quote",
	askNew: "quote-popover-new-thread",
	aside: "quote-popover-aside",
};
