// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { SettledState, ThreadRow } from "@prismalens/contracts";
import { useEffect, useState } from "react";

export const UNDO_MS = 8000;

export interface SettleVars {
	id: string;
	settled: boolean;
	restore?: SettledState[];
}
interface SettleOpts {
	onSuccess?: (out: {
		ids: string[];
		previous: SettledState[];
		/** The server's end of the Undo window (#1024); absent before Surface F, which then uses UNDO_MS. */
		undoUntil?: string | null;
	}) => void;
	onError?: (err: unknown) => void;
}
export interface SettleCall {
	vars: SettleVars;
	opts: SettleOpts;
}
export interface UndoEntry {
	id: string;
	title: string;
	previous?: SettledState[];
	restoring?: boolean;
	/** When Undo closes, from the server, never a timer started on arrival. */
	until?: number;
}
export interface SettleUndo {
	undo: UndoEntry | null;
	settle: (t: ThreadRow) => void;
	restore: () => void;
}

/**
 * Settle with one Undo line. The window opens once Settle returns the exact states to put
 * back, and those states are kept until a restore succeeds (#1020).
 */
export function useSettleUndo(
	mutate: (vars: SettleVars, opts: SettleOpts) => void,
): SettleUndo {
	const [undo, setUndo] = useState<UndoEntry | null>(null);

	useEffect(() => {
		if (!undo?.previous || undo.restoring) return;
		const t = window.setTimeout(
			() => setUndo((u) => (u === undo ? null : u)),
			undo.until ? Math.max(0, undo.until - Date.now()) : UNDO_MS,
		);
		return () => window.clearTimeout(t);
	}, [undo]);

	const settle = (t: ThreadRow) => {
		if (undo?.id === t.id) return;
		const id = t.id;
		setUndo({ id, title: t.title?.trim() || "Thread" });
		mutate(
			{ id, settled: true },
			{
				onSuccess: ({ previous, undoUntil }) =>
					setUndo((u) =>
						u?.id === id
							? {
									...u,
									previous,
									...(undoUntil ? { until: Date.parse(undoUntil) } : {}),
								}
							: u,
					),
				onError: () => setUndo((u) => (u?.id === id && !u.previous ? null : u)),
			},
		);
	};

	const restore = () => {
		if (!undo?.previous || undo.restoring) return;
		const { id, previous } = undo;
		setUndo({ ...undo, restoring: true });
		mutate(
			{ id, settled: false, restore: previous },
			{
				onSuccess: () => setUndo((u) => (u?.id === id ? null : u)),
				onError: () =>
					setUndo((u) => (u?.id === id ? { ...u, restoring: false } : u)),
			},
		);
	};

	return { undo, settle, restore };
}
