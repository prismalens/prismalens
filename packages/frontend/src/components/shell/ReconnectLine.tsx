// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect, useRef } from "react";
import { useNow } from "@/hooks/use-now";
import { lineAsOf, useStreamStatus } from "@/lib/api/live-refresh";
import { connectionWord } from "@/lib/connection-word";
import { formatClock } from "@/lib/format-time";

/**
 * One line at the top of the main area while the change stream is down
 * (study-v2 §6): amber, static, gone on reconnect. Every page shows it, a
 * thread's too, once a drop is seen (#1101 category 12). While it shows, every
 * breathing loop holds still (motion.css, `data-reconnecting`).
 */
export function ReconnectLine() {
	const status = useStreamStatus();
	const now = useNow(1_000);
	// The device saying it is offline shows the line by itself, whatever the stream last reported.
	const offlineSince = useRef<number | null>(null);
	const offline = now !== null && navigator.onLine === false;
	if (!offline) offlineSince.current = null;
	else offlineSince.current ??= now;
	const asOf =
		now === null ? null : (lineAsOf(status, now) ?? offlineSince.current);
	const shown = asOf !== null;
	useEffect(() => {
		const root = document.documentElement;
		root.style.setProperty("--reconnect-h", shown ? "28px" : "0px");
		root.toggleAttribute("data-reconnecting", shown);
		return () => {
			root.style.setProperty("--reconnect-h", "0px");
			root.removeAttribute("data-reconnecting");
		};
	}, [shown]);
	if (asOf === null) return null;
	return (
		<div
			role="status"
			className="fixed inset-x-0 top-(--header-h) z-30 flex h-7 items-center gap-2 bg-surface-1 px-4 text-meta text-text-2 md:top-0 md:left-(--sidebar-w) md:px-6"
			data-title-row
			data-testid="reconnect-line"
		>
			<span aria-hidden className="h-3 w-[3px] shrink-0 rounded-full bg-warn" />
			<span className="max-md:hidden">
				Connection lost, retrying. What you see is as of {formatClock(asOf)}.
			</span>
			{/* The phone header says the word; this line says why (#1101 category 5). */}
			<span className="truncate md:hidden" data-testid="reconnect-line-why">
				{now !== null && connectionWord(status, now, navigator.onLine).reason}
			</span>
		</div>
	);
}
