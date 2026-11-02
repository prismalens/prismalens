// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Project, service and no-subject threads (#1020).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

export const threadKeys = {
	all: () => orpc.threads.key(),
	lists: () => orpc.threads.list.key(),
};

/** A project's or a service's own threads, newest first. */
export function useThreads(params: {
	repositoryId?: string;
	serviceId?: string;
}) {
	return useQuery({
		...orpc.threads.list.queryOptions({ input: { ...params, limit: 50 } }),
		enabled: !!(params.repositoryId || params.serviceId),
	});
}

/** The first message starts the thread's run. */
export function useStartThread() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.threads.start.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: threadKeys.lists() });
		},
	});
}
