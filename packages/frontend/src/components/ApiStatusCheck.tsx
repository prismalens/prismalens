"use client";

import { useQuery } from "@tanstack/react-query";

interface HealthResponse {
	status: string;
}

export function ApiStatusCheck() {
	const { data, isLoading, isError } = useQuery({
		queryKey: ["health"],
		queryFn: async () => {
			// Health endpoint is at /health (not /api/health)
			// It's excluded from the API global prefix
			const response = await fetch("/health");
			if (!response.ok) {
				throw new Error("Health check failed");
			}
			return response.json() as Promise<HealthResponse>;
		},
		retry: 1,
		staleTime: 30000, // Cache for 30 seconds
	});

	if (isLoading) {
		return (
			<div className="text-sm text-muted-foreground">
				Checking API connection...
			</div>
		);
	}

	if (isError) {
		return (
			<div className="text-sm text-red-600 dark:text-red-400">
				API disconnected
			</div>
		);
	}

	return (
		<div className="text-sm text-muted-foreground">
			API connected: {data?.status}
		</div>
	);
}
