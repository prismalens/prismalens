"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api/client";

interface HealthResponse {
	status: string;
}

export function ApiStatusCheck() {
	const { data, isLoading } = useQuery({
		queryKey: ["health"],
		queryFn: () => apiGet<HealthResponse>("/health"),
	});

	if (isLoading) {
		return (
			<div className="text-sm text-muted-foreground">
				Checking API connection...
			</div>
		);
	}

	return (
		<div className="text-sm text-green-600 dark:text-green-400">
			API connected: {data?.status}
		</div>
	);
}
