// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ScheduleTick } from "@prismalens/contracts";
import { useState } from "react";
import { client } from "@/lib/api/orpc-client";

/** Pages past the first 30 runs on demand; the first page stays the live query (adversary OBJ-018). */
export function useOlderTicks(id: string, onError: (e: unknown) => void) {
	const [ticks, setTicks] = useState<ScheduleTick[]>([]);
	const [cursor, setCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const more = async (from: string | null) => {
		if (!from) return;
		setLoading(true);
		try {
			const page = await client.schedules.get({ id, cursor: from, limit: 30 });
			setTicks((t) => [...t, ...page.ticks]);
			setCursor(page.nextCursor ?? "");
		} catch (e) {
			onError(e);
		} finally {
			setLoading(false);
		}
	};
	return {
		ticks,
		cursor: cursor === "" ? null : cursor,
		loading,
		more,
		done: cursor === "",
	};
}
