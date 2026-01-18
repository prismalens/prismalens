/**
 * oRPC Client for PrismaLens Frontend
 *
 * Provides type-safe API calls using oRPC contracts.
 * Integrates with TanStack Query for data fetching.
 *
 * Uses OpenAPILink to match the NestJS @Implement decorator routes.
 */
import { createORPCClient } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { contract, type Contract } from "@prismalens/contracts";

/**
 * API base URL
 * - Browser: Use absolute URL with current origin (works with Vite proxy)
 * - SSR: Use absolute URL to the API server directly
 *
 * Must be an absolute URL to avoid "Failed to construct 'URL'" errors
 */
const API_BASE_URL =
	typeof window !== "undefined"
		? `${window.location.origin}/api`
		: `${process.env.PRISMALENS_PROTOCOL || "http"}://${process.env.PRISMALENS_HOST || "localhost"}:${process.env.PRISMALENS_PORT || "3001"}/api`;

/**
 * Custom error class for connection errors
 */
export class ConnectionError extends Error {
	constructor(message: string = "Unable to connect to API server") {
		super(message);
		this.name = "ConnectionError";
	}
}

/**
 * OpenAPI Link for oRPC client
 * Uses OpenAPI-compatible paths that match the NestJS @Implement routes
 * (e.g., POST /api/setup instead of POST /api/setup/createOwner)
 */
const link = new OpenAPILink(contract, {
	url: API_BASE_URL,
	headers: () => ({
		"Content-Type": "application/json",
	}),
	fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
		try {
			const response = await fetch(input, {
				...init,
				credentials: "include", // Send cookies for authentication
			});

			// Handle gateway errors as connection errors
			if (
				response.status === 502 ||
				response.status === 503 ||
				response.status === 504
			) {
				throw new ConnectionError("API server is unavailable");
			}

			return response;
		} catch (error) {
			// Network errors (fetch throws TypeError for network failures)
			if (error instanceof TypeError) {
				throw new ConnectionError();
			}
			throw error;
		}
	},
});

/**
 * Type-safe oRPC client
 * Use this for direct API calls when not using TanStack Query
 */
export const client: ContractRouterClient<Contract> = createORPCClient(link);

/**
 * TanStack Query utilities for oRPC
 * Use this with useQuery, useMutation, etc.
 *
 * @example
 * ```tsx
 * import { useQuery } from '@tanstack/react-query'
 * import { orpc } from '@/lib/api/orpc-client'
 *
 * function AlertsList() {
 *   const { data, isLoading } = useQuery(
 *     orpc.alerts.list.queryOptions({
 *       input: { limit: 20 }
 *     })
 *   )
 *   // ...
 * }
 * ```
 */
export const orpc = createTanstackQueryUtils(client);

// Re-export types for convenience
export type { Contract } from "@prismalens/contracts";
