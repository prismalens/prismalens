// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/** Who started a thread and the threads it started (`GET /threads/{id}/links`). */
export function useThreadLinks(id: string | null, live = false) {
	return useQuery({
		...orpc.threadTree.links.queryOptions({ input: { id: id ?? "" } }),
		enabled: !!id,
		refetchInterval: live ? 10_000 : false,
	});
}

/** Ends "Allow for threads started from here" (host only). */
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
