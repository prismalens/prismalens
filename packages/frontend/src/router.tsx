// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ORPCError } from "@orpc/client";
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { hasConnected } from "@/lib/api/live-refresh";
import { ConnectionError } from "@/lib/api/orpc-client";
import { routeTree } from "./routeTree.gen";

/**
 * Shared QueryClient instance
 *
 * Created here so it can be passed to both:
 * 1. Router context (for use in beforeLoad hooks)
 * 2. QueryClientProvider (for use in React components)
 */
export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 60 * 1000, // 1 minute
			refetchOnWindowFocus: false,
			retry: (failureCount, error) => {
				// Don't retry connection errors - they should show error page immediately
				if (error instanceof ConnectionError) {
					return false;
				}
				// A 4xx will not change on a retry, and a 429 asks us to slow down
				// (#527): only server and network failures are worth another try.
				if (
					error instanceof ORPCError &&
					error.status >= 400 &&
					error.status < 500
				) {
					return false;
				}
				return failureCount < 3;
			},
			retryDelay: (attemptIndex) => Math.min(100 * 2 ** attemptIndex, 1000),
			// A first load that cannot reach the server shows the error page. Once the app has
			// reached it, a query loading for the first time fails under the reconnect line
			// instead, so a dropped link never replaces the page (#1101 category 12).
			throwOnError: (error, query) =>
				error instanceof ConnectionError &&
				query.state.data === undefined &&
				!hasConnected(),
		},
	},
});

/**
 * Router context type
 * Provides access to queryClient in route beforeLoad hooks
 */
export interface RouterContext {
	queryClient: QueryClient;
}

export function getRouter() {
	const router = createRouter({
		routeTree,
		scrollRestoration: true,
		context: { queryClient },
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
