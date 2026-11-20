// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect, useState } from "react";
import { relTime } from "@/components/kit/rel-time";

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

/** An age in the kit's one relative format ("4m", "3h"); empty until `now` is known. */
export function ago(at: string | Date | number, now: number | null): string {
	return relTime(at, now);
}
