// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect, useState } from "react";

/**
 * The current time, ticking on the client. Null on the server and on the
 * first client render, so anything derived from "now" (an age, a countdown)
 * renders identically on both sides and never trips hydration; it fills in on
 * the next tick.
 */
export function useNow(intervalMs = 10_000): number | null {
	const [now, setNow] = useState<number | null>(null);
	useEffect(() => {
		setNow(Date.now());
		const id = window.setInterval(() => setNow(Date.now()), intervalMs);
		return () => window.clearInterval(id);
	}, [intervalMs]);
	return now;
}

/** `12s ago`, `4m ago`, `3h ago`, `2d ago`; empty until `now` is known. */
export function ago(at: string | Date | number, now: number | null): string {
	if (now === null) return "";
	const s = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
	if (s < 60) return `${s}s ago`;
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86_400)}d ago`;
}
