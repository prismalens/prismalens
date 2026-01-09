import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { type ReactNode, useState } from "react";
import { ConnectionError } from "@/lib/api/orpc-client";

interface QueryProviderProps {
	children: ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						staleTime: 60 * 1000, // 1 minute
						refetchOnWindowFocus: false,
						retry: (failureCount, error) => {
							// Don't retry connection errors - they should show error page immediately
							if (error instanceof ConnectionError) {
								return false;
							}
							return failureCount < 1;
						},
						// Throw connection errors to the error boundary
						throwOnError: (error) => error instanceof ConnectionError,
					},
				},
			}),
	);

	return (
		<QueryClientProvider client={queryClient}>
			{children}
			<ReactQueryDevtools initialIsOpen={false} />
		</QueryClientProvider>
	);
}
