// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessId } from "@prismalens/config/harness";
import type { HarnessStatus } from "@prismalens/contracts";
import { useHarnessSettings, useUpdateHarnessSettings } from "@/lib/api/hooks";

/** Pinning an agent as the one new runs take: the `harness` setting that Models → New thread edits. */
export function useForNewRuns(agent: HarnessStatus) {
	const id = agent.id as HarnessId;
	const settings = useHarnessSettings().data;
	const update = useUpdateHarnessSettings();
	const pinned = settings?.harness === id;
	return {
		pinned,
		canUse: agent.runnable && !agent.off && !pinned,
		pending: update.isPending,
		use: () => update.mutate({ harness: id }),
	};
}

/** What an agent says it is signed in as: its own account, else the providers it holds a login for. */
export function accountLine(h: HarnessStatus): {
	label: string;
	email: string | null;
} | null {
	const account = h.checked?.account;
	if (account) return { label: account.label, email: account.email ?? null };
	const providers = h.checked?.providers ?? [];
	return providers.length
		? { label: `Signed in to ${providers.join(", ")}`, email: null }
		: null;
}
