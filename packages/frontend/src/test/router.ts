// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Whoami } from "@prismalens/contracts";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { operatorQueryOptions } from "@/hooks/use-operator";
import { routeTree } from "@/routeTree.gen";

/**
 * The app's route tree at `url` on a memory history, loaded but not rendered, for a paired
 * device: the one fixture the authenticated layout's gate reads.
 */
export async function routerAt(url: string) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const paired: Whoami = { via: "device", scopes: [] };
	queryClient.setQueryData(operatorQueryOptions().queryKey, paired);
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: [url] }),
		context: { queryClient },
	});
	await router.load();
	return router;
}
