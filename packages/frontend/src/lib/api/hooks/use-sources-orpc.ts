// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/** Every category with its status, probed live by the api, and what it detected (#848). */
export function useSourcesOverview() {
	return useQuery({
		...orpc.sources.overview.queryOptions({ input: {} }),
		staleTime: 30_000,
	});
}

export function useTestSource() {
	return useMutation(orpc.sources.test.mutationOptions());
}

export function useRetestSource() {
	return useMutation(orpc.sources.retest.mutationOptions());
}

export function useConnectSource() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.sources.connect.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.sources.key() });
			queryClient.invalidateQueries({ queryKey: orpc.integrations.key() });
		},
	});
}
