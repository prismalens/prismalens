// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { FixItem } from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/** What a fix thread would send and where it would run (`POST …/fix-preview`); read when the dialog opens. */
export function useFixPreview(
	threadId: string | undefined,
	prId: string | undefined,
	items: FixItem[],
	enabled = true,
) {
	return useQuery({
		...orpc.threads.fixPreview.queryOptions({
			input: { id: threadId ?? "", prId: prId ?? "", items },
		}),
		enabled: enabled && !!threadId && !!prId && items.length > 0,
		staleTime: 0,
		retry: false,
	});
}

/** Start the previewed fix thread; a changed preview answers CONFLICT. */
export function useStartFixThread() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.threads.fixStart.mutationOptions(),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: orpc.threads.key() }),
	});
}

/** Re-run one check on the host; a retry sends the same confirm key. */
export function useRerunCheck() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.threads.prCheckRerun.mutationOptions(),
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: orpc.threads.pullRequests.key(),
			}),
	});
}

/** The files a PR changes, read live from the host. */
export function usePrFiles(
	threadId: string | undefined,
	prId: string | undefined,
	enabled = true,
) {
	return useQuery({
		...orpc.threads.prFiles.queryOptions({
			input: { id: threadId ?? "", prId: prId ?? "" },
		}),
		enabled: enabled && !!threadId && !!prId,
		staleTime: 60_000,
		retry: false,
	});
}

/** What a fork or side question of this thread carries over. */
export function useForkPreview(threadId: string | undefined, enabled = true) {
	return useQuery({
		...orpc.threads.forkPreview.queryOptions({
			input: { id: threadId ?? "" },
		}),
		enabled: enabled && !!threadId,
		staleTime: 30_000,
	});
}
