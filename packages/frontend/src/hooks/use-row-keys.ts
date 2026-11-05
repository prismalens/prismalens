// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { type RefObject, useEffect } from "react";

function isTyping(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	const tag = el?.tagName;
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		!!el?.isContentEditable
	);
}

/** The row after (1) or before (-1) the focused one; from outside the list, the current row or the first. */
export function nextRow(
	rows: HTMLElement[],
	active: Element | null,
	dir: 1 | -1,
): HTMLElement | undefined {
	const at = rows.findIndex((r) => r === active);
	if (at >= 0) return rows[Math.min(rows.length - 1, Math.max(0, at + dir))];
	return rows.find((r) => r.getAttribute("aria-current") === "page") ?? rows[0];
}

/**
 * `j` / `k` move focus down and up the rows matching `selector` inside `ref`; Enter
 * opens the focused link as any link does. Ignored while typing or with a dialog open.
 */
export function useRowKeys(
	ref: RefObject<HTMLElement | null>,
	selector: string,
): void {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "j" && e.key !== "k") return;
			if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
			if (document.querySelector("[role=dialog], [role=alertdialog]")) return;
			const root = ref.current;
			if (!root) return;
			const rows = Array.from(root.querySelectorAll<HTMLElement>(selector));
			const row = nextRow(rows, document.activeElement, e.key === "j" ? 1 : -1);
			if (!row) return;
			e.preventDefault();
			row.focus();
			row.scrollIntoView?.({ block: "nearest" });
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [ref, selector]);
}
