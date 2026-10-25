// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/** Every telemetry connection with its state, and the git hosts (#848 C17). */
export function useSourcesOverview(enabled = true) {
	return useQuery({
		...orpc.sources.overview.queryOptions({ input: {} }),
		enabled,
		staleTime: 30_000,
	});
}

/** A draft's probe: the address and credential only; nothing is saved. */
export function useTestSource() {
	return useMutation(orpc.sources.test.mutationOptions());
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

/** What a service's runs would read for a deployment: the run's own resolver, shown as it answers (C16a). */
export function useSourcesPreRun(
	serviceId: string | null,
	deployment?: string,
) {
	return useQuery({
		...orpc.sources.preRun.queryOptions({
			input: {
				serviceId: serviceId ?? "",
				...(deployment ? { deployment } : {}),
			},
		}),
		enabled: !!serviceId,
		staleTime: 30_000,
	});
}
