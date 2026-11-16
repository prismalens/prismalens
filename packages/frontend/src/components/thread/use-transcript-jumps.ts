// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { itemEventKey } from "@/components/investigation/WindowedTranscript";
import type { RunStep } from "@/components/run/run-steps";
import type { TranscriptItem } from "@/lib/investigation-events";
import type { ThreadWindow } from "@/lib/thread-window/use-thread-window";

function callOf(e: CanonicalEvent): string | null {
	if (e.kind === "tool_result") return e.result.toolCallId;
	if (e.kind === "agent_step") return e.toolCalls[0]?.toolCallId ?? null;
	if (e.kind === "harness_tool_call") return e.callId ?? null;
	return null;
}

/**
 * Jumps in a windowed transcript (#1101 cats 12-14): a rail tick, a find hit or a
 * `#item-` link loads the page around its item, opens the step that holds it, and
 * scrolls it into view; the rows on screen are reported back for the rail.
 */
export function useTranscriptJumps(
	win: ThreadWindow | null,
	steps: readonly RunStep[],
	hashAt: string | undefined,
	setOpenSteps: (f: (o: ReadonlySet<number>) => ReadonlySet<number>) => void,
) {
	const [target, setTarget] = useState<{ key: string; nonce: number } | null>(
		null,
	);
	const [range, setRangeState] = useState<{
		first: string | null;
		last: string | null;
	}>({ first: null, last: null });
	// Compared outside React: an updater that returns the same range still schedules a
	// render, and one per streamed row chained React's nested-update limit (#1101 agent.runaway).
	const shown = useRef(range);
	const setRange = useCallback((first: string | null, last: string | null) => {
		const r = shown.current;
		if (r.first === first && r.last === last) return;
		shown.current = { first, last };
		setRangeState(shown.current);
	}, []);
	const winRef = useRef(win);
	winRef.current = win;
	const nonce = useRef(0);

	const goTo = useCallback(async (key: string) => {
		const w = winRef.current;
		if (!w) return;
		await w.jumpTo(key);
		nonce.current++;
		setTarget({ key, nonce: nonce.current });
	}, []);

	// A hit inside a tool step opens the step, so its output is on screen.
	const items = win?.items;
	useEffect(() => {
		if (!target || !items) return;
		const it = items.find((i) => i.key === target.key);
		const call = it ? callOf(it.event) : null;
		const n = call ? steps.find((s) => s.callId === call)?.n : undefined;
		if (n === undefined) return;
		setOpenSteps((o) => (o.has(n) ? o : new Set(o).add(n)));
	}, [target, items, steps, setOpenSteps]);

	// A `#item-` link lands once the server's window is in.
	const landed = useRef(false);
	const source = win?.source;
	useEffect(() => {
		if (landed.current || !hashAt || source !== "server" || !items) return;
		landed.current = true;
		const key = /^\d+$/.test(hashAt)
			? items.find((i) => i.event.seq === Number(hashAt))?.key
			: hashAt;
		if (!key) return;
		nonce.current++;
		setTarget({ key, nonce: nonce.current });
	}, [hashAt, source, items]);

	// Events a page cut, by item: a tool group's calls, or a message's own key.
	const fullFor = useMemo(() => {
		const cutByCall = new Map<string, string[]>();
		const cutKeys = new Set<string>();
		for (const it of items ?? []) {
			if (!it.cut) continue;
			cutKeys.add(it.key);
			const call = callOf(it.event);
			if (call) cutByCall.set(call, [...(cutByCall.get(call) ?? []), it.key]);
		}
		return (item: TranscriptItem): (() => Promise<void>) | null => {
			const w = winRef.current;
			if (!w || cutKeys.size === 0) return null;
			const keys =
				item.kind === "tools"
					? item.callIds.flatMap((c) => cutByCall.get(c) ?? [])
					: [itemEventKey(item.key)].filter(
							(k): k is string => !!k && cutKeys.has(k),
						);
			if (keys.length === 0) return null;
			return async () => {
				await Promise.all(keys.map((k) => w.full(k)));
			};
		};
	}, [items]);

	return { target, range, setRange, goTo, fullFor };
}
