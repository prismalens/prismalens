// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/api/orpc-client";
import { useFollowThread } from "@/lib/attention/use-attention";

/** A thread's follow choice and its toggle: the button and the phone header menu share it. */
export function useThreadFollow(threadId: string) {
	const view = useQuery(
		orpc.attention.threads.queryOptions({ input: { ids: [threadId] } }),
	);
	const follow = view.data?.[0]?.follow ?? null;
	const set = useFollowThread();
	const choose = (next: "watch" | "mute") =>
		set.mutate(
			{ id: threadId, follow: follow === next ? null : next },
			{ onSettled: () => void view.refetch() },
		);
	return { follow, choose };
}
