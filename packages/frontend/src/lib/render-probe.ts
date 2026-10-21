// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect, useRef } from "react";

/** One committed render: who, and which watched inputs changed identity since its last commit. */
export interface RenderRecord {
	name: string;
	reason: string;
	at: number;
}

export interface RenderProbe {
	log: RenderRecord[];
	reset(): void;
	/** Commits per component name since the last reset. */
	counts(): Record<string, number>;
}

declare global {
	interface Window {
		__renderProbe?: RenderProbe;
	}
}

function probe(): RenderProbe {
	if (!window.__renderProbe) {
		const log: RenderRecord[] = [];
		window.__renderProbe = {
			log,
			reset: () => {
				log.length = 0;
			},
			counts: () => {
				const out: Record<string, number> = {};
				for (const r of log) out[r.name] = (out[r.name] ?? 0) + 1;
				return out;
			},
		};
	}
	return window.__renderProbe;
}

/** The changed keys, `mount`, or `parent or state` when no watched input moved. */
export function renderReason(
	prev: Record<string, unknown> | null,
	next: Record<string, unknown>,
): string {
	if (!prev) return "mount";
	const changed = Object.keys(next).filter((k) => !Object.is(prev[k], next[k]));
	return changed.length ? changed.join(",") : "parent or state";
}

/**
 * Dev only: records each commit of the calling component in
 * `window.__renderProbe`, with why it rendered (#874). A no-op in builds.
 */
export function useRenderProbe(
	name: string,
	watched: Record<string, unknown> = {},
): void {
	const prev = useRef<Record<string, unknown> | null>(null);
	useEffect(() => {
		if (!import.meta.env.DEV) return;
		probe().log.push({
			name,
			reason: renderReason(prev.current, watched),
			at: performance.now(),
		});
		prev.current = watched;
	});
}
