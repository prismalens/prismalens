// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect } from "react";
import { useNow } from "@/hooks/use-now";
import { reconnectAsOf, useStreamStatus } from "@/lib/api/live-refresh";
import { formatClock } from "@/lib/format-time";

/**
 * One line at the top of the main area while the change stream is down
 * (study-v2 §6): amber, static, gone on reconnect. While it shows, every
 * breathing loop holds still (motion.css, `data-reconnecting`).
 */
export function ReconnectLine() {
	const status = useStreamStatus();
	const now = useNow(1_000);
	const asOf = now === null ? null : reconnectAsOf(status, now);
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
			className="fixed inset-x-0 top-(--header-h) z-30 flex h-7 items-center gap-2 bg-surface-1 px-4 text-meta text-text-2 md:top-(--titlebar-h) md:left-(--sidebar-w) md:px-6"
			data-testid="reconnect-line"
		>
			<span aria-hidden className="h-3 w-[3px] shrink-0 rounded-full bg-warn" />
			Connection lost, retrying. What you see is as of {formatClock(asOf)}.
		</div>
	);
}
