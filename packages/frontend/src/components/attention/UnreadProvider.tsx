// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadRow } from "@prismalens/contracts";
import { type ReactNode, useCallback, useMemo } from "react";
import { RowUnread } from "@/components/shell/ThreadTree";
import { useOperator } from "@/hooks/use-operator";
import { useAttentionEvents } from "@/lib/attention/use-attention";

/**
 * Feeds the list's unread mark from the server's read state (#1101 category 2 item 5):
 * a thread is unread while it holds an unread event or an unseen outcome, on every device.
 */
export function UnreadProvider({ children }: { children: ReactNode }) {
	const signedIn = useOperator().via !== null;
	const events = useAttentionEvents("unread", 200, signedIn).data?.events;
	const ids = useMemo(
		() => new Set(events?.map((e) => e.threadId) ?? []),
		[events],
	);
	const unread = useCallback(
		(t: ThreadRow) => t.unseen || ids.has(t.id),
		[ids],
	);
	return <RowUnread.Provider value={unread}>{children}</RowUnread.Provider>;
}
