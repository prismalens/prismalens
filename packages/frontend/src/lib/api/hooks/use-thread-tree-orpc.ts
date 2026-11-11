// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/** The threads an agent started from this one, root first (`GET /threads/{id}/tree`). */
export function useThreadTree(id: string | null, live = false) {
	return useQuery({
		...orpc.threadTree.tree.queryOptions({ input: { id: id ?? "" } }),
		enabled: !!id,
		refetchInterval: live ? 10_000 : false,
	});
}

/** Ends "Allow for this thread tree" (host only). */
export function useRevokeTreeAllowance() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.threadTree.revokeAllowance.mutationOptions(),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: orpc.threadTree.key() }),
	});
}

/** Applies or dismisses an agent's proposal; the server applies it through the normal API. */
export function useResolveProposal() {
	const queryClient = useQueryClient();
	const apply = useMutation({
		...orpc.threadTree.applyProposal.mutationOptions(),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: orpc.threadTree.key() }),
	});
	const dismiss = useMutation({
		...orpc.threadTree.dismissProposal.mutationOptions(),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: orpc.threadTree.key() }),
	});
	return { apply, dismiss };
}
