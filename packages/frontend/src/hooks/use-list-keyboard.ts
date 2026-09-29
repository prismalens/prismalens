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
	/** Index of the keyboard-highlighted row, or -1 when nothing is highlighted. */
	cursor: number;
	/**
	 * The pointer entered a row: `j` / `k` continue from it. The pointer's own
	 * highlight is CSS `:hover`, so nothing stays lit once it leaves the row.
	 */
	pointAt: (index: number) => void;
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
	/** The cursor was last moved by a key, not by the pointer. */
	const [keyed, setKeyed] = useState(false);

	useEffect(() => {
		if (cursor >= count) setCursor(count - 1);
	}, [count, cursor]);

	const onKey = useCallback(
		(e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
			if (count === 0) return;
			if (e.key === "j" || e.key === "ArrowDown") {
				e.preventDefault();
				setKeyed(true);
				setCursor((c) => Math.min(count - 1, c + 1));
			} else if (e.key === "k" || e.key === "ArrowUp") {
				e.preventDefault();
				setKeyed(true);
				setCursor((c) => Math.max(0, c - 1));
			} else if (e.key === "Enter" && keyed && cursor >= 0) {
				e.preventDefault();
				onOpen(cursor);
			} else if (e.key === "Escape") {
				setCursor(-1);
			}
		},
		[count, cursor, keyed, onOpen],
	);

	useEffect(() => {
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onKey]);

	const pointAt = useCallback((index: number) => {
		setCursor(index);
		setKeyed(false);
	}, []);

	return { cursor: keyed ? cursor : -1, pointAt };
}
