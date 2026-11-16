// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import type { TranscriptView } from "@/lib/transcript-view";

/**
 * The thread's folds (#1101 cat 12 item 6): the view level decides each fold's default,
 * and a fold opened or closed by hand keeps that until the thread unmounts; never saved.
 */
export interface FoldState {
	level: TranscriptView;
	isOpen: (key: string, byDefault?: boolean) => boolean;
	set: (key: string, open: boolean) => void;
	/** Opens folds by key, as a find hit or a jump does. */
	open: (keys: readonly string[]) => void;
}

const Ctx = createContext<FoldState>({
	level: "standard",
	isOpen: (_, d = false) => d,
	set: () => {},
	open: () => {},
});

export function useFoldState(level: TranscriptView): FoldState {
	const [hand, setHand] = useState<ReadonlyMap<string, boolean>>(new Map());
	const set = useCallback(
		(key: string, open: boolean) => setHand((m) => new Map(m).set(key, open)),
		[],
	);
	const open = useCallback(
		(keys: readonly string[]) =>
			setHand((m) => {
				if (keys.every((k) => m.get(k) === true)) return m;
				const next = new Map(m);
				for (const k of keys) next.set(k, true);
				return next;
			}),
		[],
	);
	return useMemo(
		() => ({
			level,
			isOpen: (key, byDefault = level === "full") => hand.get(key) ?? byDefault,
			set,
			open,
		}),
		[level, hand, set, open],
	);
}

export const FoldProvider = Ctx.Provider;

/** One fold: whether it is open, its toggle, and a setter; each records a hand choice. */
export function useFold(
	key: string,
	byDefault?: boolean,
): [boolean, () => void, (open: boolean) => void] {
	const s = useContext(Ctx);
	const isOpen = s.isOpen(key, byDefault);
	return [isOpen, () => s.set(key, !isOpen), (open) => s.set(key, open)];
}

export function useFoldLevel(): TranscriptView {
	return useContext(Ctx).level;
}
