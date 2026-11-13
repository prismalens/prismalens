// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { WorktreeChanges } from "@prismalens/contracts";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/api/orpc-client";

/** The run's live changes, polled while it works; one query feeds the tab and the status box. */
export function useWorktreeChanges(runId: string, live: boolean) {
	return useQuery({
		...orpc.investigations.getChanges.queryOptions({ input: { id: runId } }),
		refetchInterval: live ? 5000 : false,
		retry: false,
	});
}

/** The status box's totals: files and counts only, never a patch (#1101 category 16 item 7). */
export function useWorktreeTotals(runId: string, live: boolean) {
	return useQuery({
		...orpc.investigations.getChanges.queryOptions({
			input: { id: runId, patch: "none" },
		}),
		refetchInterval: live ? 5000 : false,
		retry: false,
	});
}

/** `+77 −3` across every repo that answered; null until one did. */
export function changeTotals(
	data: WorktreeChanges | undefined,
): { additions: number; deletions: number } | null {
	const ok = data?.repos.filter((r) => r.state === "ok") ?? [];
	if (ok.length === 0) return null;
	return {
		additions: ok.reduce((n, r) => n + (r.state === "ok" ? r.additions : 0), 0),
		deletions: ok.reduce((n, r) => n + (r.state === "ok" ? r.deletions : 0), 0),
	};
}
