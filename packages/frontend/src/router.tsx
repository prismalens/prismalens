import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { ConnectionError } from "@/lib/api/orpc-client";

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
				// Retry up to 3 times for other errors
				return failureCount < 3;
			},
			retryDelay: (attemptIndex) => Math.min(100 * 2 ** attemptIndex, 1000),
			// Throw connection errors to the error boundary
			throwOnError: (error) => error instanceof ConnectionError,
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
