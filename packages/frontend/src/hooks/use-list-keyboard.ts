// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useCallback, useEffect, useState } from "react";

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

export interface ListKeyboard {
	/** Index of the highlighted row, or -1 when nothing is highlighted. */
	cursor: number;
	setCursor: (index: number) => void;
}

/**
 * `j` / `k` (or the arrow keys) move a cursor over a list; `Enter` opens the
 * highlighted row. The cursor is state the caller renders, so the rows stay
 * plain markup. Keys are ignored while the operator is typing anywhere.
 */
export function useListKeyboard(
	count: number,
	onOpen: (index: number) => void,
): ListKeyboard {
	const [cursor, setCursor] = useState(-1);

	useEffect(() => {
		if (cursor >= count) setCursor(count - 1);
	}, [count, cursor]);

	const onKey = useCallback(
		(e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
			if (count === 0) return;
			if (e.key === "j" || e.key === "ArrowDown") {
				e.preventDefault();
				setCursor((c) => Math.min(count - 1, c + 1));
			} else if (e.key === "k" || e.key === "ArrowUp") {
				e.preventDefault();
				setCursor((c) => Math.max(0, c - 1));
			} else if (e.key === "Enter" && cursor >= 0) {
				e.preventDefault();
				onOpen(cursor);
			} else if (e.key === "Escape") {
				setCursor(-1);
			}
		},
		[count, cursor, onOpen],
	);

	useEffect(() => {
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onKey]);

	return { cursor, setCursor };
}
